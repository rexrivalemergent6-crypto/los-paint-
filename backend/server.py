from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, secrets, asyncio, io, csv, re
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import jwt
import base58
import httpx
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
from cryptography.fernet import Fernet
from pydantic import BaseModel, Field
from solders.pubkey import Pubkey

import winternitz as wots
import solana_vault as sv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
SESSION_TTL_DAYS = 7
CHALLENGE_TTL_MIN = 5
AUTH_DOMAIN = os.environ.get("AUTH_DOMAIN", "localhost")
RPC_URL = os.environ["SOLANA_RPC_URL"]
CLUSTER = os.environ.get("SOLANA_CLUSTER", "mainnet-beta")
fernet = Fernet(os.environ["WOTS_ENC_KEY"].encode())

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("quantumpos")

app = FastAPI(title="QuantumPOS")
api = APIRouter(prefix="/api")


# ----------------------------- helpers -----------------------------
def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def public_invoice(inv: dict, include_merchant_name: Optional[str] = None) -> dict:
    received_lamports = max(0, (inv.get("observed_lamports") or 0) - (inv.get("rent_baseline") or 0))
    tip_lamports = max(0, received_lamports - inv["amount_lamports"]) if inv.get("allow_tips", True) else 0
    return {
        "id": inv["id"],
        "amount_sol": inv["amount_sol"],
        "amount_lamports": inv["amount_lamports"],
        "memo": inv.get("memo", ""),
        "status": inv["status"],
        "vault_address": inv["vault_address"],
        "merkle_root": inv["merkle_root_hex"],
        "bump": inv["bump"],
        "open_tx_sig": inv.get("open_tx_sig"),
        "close_tx_sig": inv.get("close_tx_sig"),
        "received_lamports": received_lamports,
        "received_sol": received_lamports / sv.LAMPORTS_PER_SOL,
        "tip_lamports": tip_lamports,
        "tip_sol": tip_lamports / sv.LAMPORTS_PER_SOL,
        "allow_tips": inv.get("allow_tips", True),
        "split_address": inv.get("split_address"),
        "split_type": inv.get("split_type"),
        "split_value": inv.get("split_value"),
        "key_used": inv.get("key_used", False),
        "usd_rate": inv.get("usd_rate"),
        "cluster": CLUSTER,
        "created_at": inv["created_at"],
        "expires_at": inv["expires_at"],
        "paid_at": inv.get("paid_at"),
        "settled_at": inv.get("settled_at"),
        "merchant_name": (inv.get("branding") or {}).get("name") or include_merchant_name,
        "branding": inv.get("branding") or {},
        "solana_pay_url": solana_pay_url(inv),
        "explorer_open": explorer_tx(inv.get("open_tx_sig")),
        "explorer_close": explorer_tx(inv.get("close_tx_sig")),
    }


def solana_pay_url(inv: dict) -> str:
    from urllib.parse import quote
    base = f"solana:{inv['vault_address']}?amount={inv['amount_sol']}"
    label = quote("QuantumPOS Payment")
    msg = quote(inv.get("memo") or f"Invoice {inv['id'][:8]}")
    ref = inv["vault_address"]
    return f"{base}&label={label}&message={msg}&reference={ref}"


def explorer_tx(sig: Optional[str]) -> Optional[str]:
    if not sig:
        return None
    suffix = "" if CLUSTER == "mainnet-beta" else f"?cluster={CLUSTER}"
    return f"https://explorer.solana.com/tx/{sig}{suffix}"


def explorer_address(addr: str) -> str:
    suffix = "" if CLUSTER == "mainnet-beta" else f"?cluster={CLUSTER}"
    return f"https://explorer.solana.com/address/{addr}{suffix}"


async def rpc_call(method: str, params: list):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    async with httpx.AsyncClient(timeout=20) as hc:
        r = await hc.post(RPC_URL, json=payload)
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise HTTPException(status_code=502, detail=f"RPC error: {data['error']}")
        return data["result"]


async def get_balance(address: str) -> int:
    res = await rpc_call("getBalance", [address, {"commitment": "confirmed"}])
    return res["value"]


async def get_account_owner(address: str) -> Optional[str]:
    res = await rpc_call("getAccountInfo", [address, {"commitment": "confirmed", "encoding": "base64"}])
    if res["value"] is None:
        return None
    return res["value"]["owner"]


# ----------------------------- auth -----------------------------
def valid_solana_address(address: str) -> bool:
    try:
        return len(base58.b58decode(address)) == 32
    except Exception:
        return False


SIWS_CHAIN = {"mainnet-beta": "mainnet", "devnet": "devnet", "testnet": "testnet"}.get(CLUSTER, CLUSTER)


def resolve_auth_origin(origin_header: Optional[str]) -> tuple:
    """Phantom blocks SIWS messages whose domain/URI don't match the requesting page,
    so bind the challenge to the actual browser origin (falls back to AUTH_DOMAIN)."""
    if origin_header:
        parsed = urlparse(origin_header)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            return parsed.netloc, f"{parsed.scheme}://{parsed.netloc}"
    return AUTH_DOMAIN, f"https://{AUTH_DOMAIN}"


def build_challenge_message(address: str, nonce: str, issued: datetime, expires: datetime,
                            domain: str = None, uri: str = None) -> str:
    domain = domain or AUTH_DOMAIN
    uri = uri or f"https://{domain}"
    return (
        f"{domain} wants you to sign in with your Solana account:\n{address}\n\n"
        f"Sign in to QuantumPOS merchant dashboard.\n\n"
        f"URI: {uri}\nVersion: 1\nChain ID: solana:{SIWS_CHAIN}\n"
        f"Nonce: {nonce}\nIssued At: {iso(issued)}\nExpiration Time: {iso(expires)}"
    )


class ChallengeIn(BaseModel):
    address: str


class VerifyIn(BaseModel):
    address: str
    message: str
    signature: str  # base58


@api.post("/auth/challenge")
async def auth_challenge(body: ChallengeIn, origin: Optional[str] = Header(default=None)):
    if not valid_solana_address(body.address):
        raise HTTPException(400, "Invalid Solana address")
    issued, expires = now(), now() + timedelta(minutes=CHALLENGE_TTL_MIN)
    nonce = secrets.token_urlsafe(24)
    domain, uri = resolve_auth_origin(origin)
    message = build_challenge_message(body.address, nonce, issued, expires, domain, uri)
    await db.challenges.insert_one({
        "nonce": nonce, "address": body.address, "message": message,
        "expires_at": expires, "created_at": issued,
    })
    return {"message": message}


@api.post("/auth/verify")
async def auth_verify(body: VerifyIn):
    if not valid_solana_address(body.address):
        raise HTTPException(400, "Invalid address")
    nonce_line = next((l for l in body.message.splitlines() if l.startswith("Nonce: ")), "")
    nonce = nonce_line.removeprefix("Nonce: ").strip()
    if not nonce:
        raise HTTPException(401, "Malformed challenge")
    challenge = await db.challenges.find_one_and_delete({
        "nonce": nonce, "address": body.address, "message": body.message,
        "expires_at": {"$gt": now()},
    })
    if not challenge:
        raise HTTPException(401, "Expired, unknown, or already-used challenge")
    try:
        public_key = base58.b58decode(body.address)
        signature = base58.b58decode(body.signature)
        if len(public_key) != 32 or len(signature) != 64:
            raise HTTPException(401, "Bad key/signature length")
        VerifyKey(public_key).verify(body.message.encode("utf-8"), signature)
    except (ValueError, BadSignatureError):
        raise HTTPException(401, "Invalid signature")

    merchant = await db.merchants.find_one({"address": body.address}, {"_id": 0})
    if not merchant:
        merchant = {
            "id": str(uuid.uuid4()), "address": body.address,
            "payout_address": body.address, "business_name": "",
            "created_at": iso(now()),
        }
        await db.merchants.insert_one(dict(merchant))
    expires = now() + timedelta(days=SESSION_TTL_DAYS)
    token = jwt.encode({"sub": body.address, "exp": expires, "iat": now()}, JWT_SECRET, algorithm=JWT_ALGO)
    return {"token": token, "merchant": merchant}


async def current_merchant(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired session")
    merchant = await db.merchants.find_one({"address": claims.get("sub")}, {"_id": 0})
    if not merchant:
        raise HTTPException(401, "Merchant not found")
    return merchant


@api.get("/auth/me")
async def auth_me(merchant: dict = Depends(current_merchant)):
    return merchant


HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGO_MAX_CHARS = 400_000  # ~300 KB data URL
SOCIAL_KEYS = ("x", "instagram", "telegram", "discord")


class BrandingIn(BaseModel):
    name: Optional[str] = ""
    logo: Optional[str] = ""          # data:image/... URL (client-resized)
    accent_color: Optional[str] = "#14F195"
    tagline: Optional[str] = ""
    website: Optional[str] = ""
    socials: Optional[dict] = None    # {x, instagram, telegram, discord}


def _clean_url(u: Optional[str]) -> str:
    u = (u or "").strip()[:300]
    if not u:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def clean_branding(b: Optional[BrandingIn]) -> dict:
    if b is None:
        return {}
    logo = (b.logo or "").strip()
    if logo:
        if not logo.startswith("data:image/"):
            raise HTTPException(400, "Logo must be an image")
        if len(logo) > LOGO_MAX_CHARS:
            raise HTTPException(400, "Logo is too large (max ~300 KB)")
    accent = (b.accent_color or "#14F195").strip()
    if not HEX_RE.match(accent):
        raise HTTPException(400, "Accent colour must be a hex value like #14F195")
    socials = {}
    for k in SOCIAL_KEYS:
        v = _clean_url((b.socials or {}).get(k))
        if v:
            socials[k] = v
    return {
        "name": (b.name or "").strip()[:80],
        "logo": logo,
        "accent_color": accent,
        "tagline": (b.tagline or "").strip()[:140],
        "website": _clean_url(b.website),
        "socials": socials,
    }


class ProfileIn(BaseModel):
    business_name: Optional[str] = None
    payout_address: Optional[str] = None
    branding: Optional[BrandingIn] = None


@api.put("/merchant/profile")
async def update_profile(body: ProfileIn, merchant: dict = Depends(current_merchant)):
    updates = {}
    if body.business_name is not None:
        updates["business_name"] = body.business_name.strip()
    if body.payout_address is not None:
        if not valid_solana_address(body.payout_address):
            raise HTTPException(400, "Invalid payout address")
        updates["payout_address"] = body.payout_address
    if body.branding is not None:
        updates["branding"] = clean_branding(body.branding)
        if updates["branding"]["name"] and body.business_name is None:
            updates["business_name"] = updates["branding"]["name"]
    if updates:
        await db.merchants.update_one({"address": merchant["address"]}, {"$set": updates})
    return await db.merchants.find_one({"address": merchant["address"]}, {"_id": 0})


# ----------------------------- invoices -----------------------------
class InvoiceIn(BaseModel):
    amount_sol: float = Field(gt=0)
    memo: Optional[str] = ""
    expiry_minutes: int = Field(default=60, ge=5, le=1440)
    allow_tips: bool = True
    split_address: Optional[str] = None
    split_type: Optional[str] = None   # "percent" | "fixed"
    split_value: Optional[float] = None
    branding: Optional[BrandingIn] = None


async def fetch_sol_usd() -> Optional[float]:
    try:
        async with httpx.AsyncClient(timeout=10) as hc:
            r = await hc.get("https://api.coingecko.com/api/v3/simple/price",
                             params={"ids": "solana", "vs_currencies": "usd"})
            if r.status_code == 200:
                return r.json().get("solana", {}).get("usd")
    except Exception as e:
        logger.warning(f"price fetch failed: {e}")
    return None


@api.get("/price")
async def price():
    return {"sol_usd": await fetch_sol_usd()}


@api.post("/invoices")
async def create_invoice(body: InvoiceIn, merchant: dict = Depends(current_merchant)):
    split_address = None
    split_type = None
    split_value = None
    if body.split_address:
        if not valid_solana_address(body.split_address):
            raise HTTPException(400, "Invalid split payout address")
        if body.split_type not in ("percent", "fixed"):
            raise HTTPException(400, "split_type must be 'percent' or 'fixed'")
        if body.split_value is None or body.split_value <= 0:
            raise HTTPException(400, "split_value must be > 0")
        if body.split_type == "percent" and body.split_value >= 100:
            raise HTTPException(400, "percent split must be < 100")
        split_address = body.split_address
        split_type = body.split_type
        split_value = body.split_value

    if body.branding is not None:
        branding = clean_branding(body.branding)
        m_updates = {"branding": branding}
        if branding["name"]:
            m_updates["business_name"] = branding["name"]
        await db.merchants.update_one({"address": merchant["address"]}, {"$set": m_updates})
    else:
        branding = merchant.get("branding") or {}

    priv = wots.generate_privkey()
    merkle_root = wots.pubkey_merkle_root(priv)
    vault_address, bump = sv.derive_vault(merkle_root)
    amount_lamports = int(round(body.amount_sol * sv.LAMPORTS_PER_SOL))
    usd = await fetch_sol_usd()
    created = now()
    inv = {
        "id": str(uuid.uuid4()),
        "merchant_address": merchant["address"],
        "amount_sol": body.amount_sol,
        "amount_lamports": amount_lamports,
        "memo": (body.memo or "").strip(),
        "status": "created",
        "wots_privkey_enc": fernet.encrypt(priv).decode(),
        "merkle_root_hex": merkle_root.hex(),
        "vault_address": vault_address,
        "bump": bump,
        "open_tx_sig": None,
        "close_tx_sig": None,
        "observed_lamports": 0,
        "rent_baseline": 0,
        "key_used": False,
        "usd_rate": usd,
        "allow_tips": body.allow_tips,
        "split_address": split_address,
        "split_type": split_type,
        "split_value": split_value,
        "branding": branding,
        "created_at": iso(created),
        "expires_at": iso(created + timedelta(minutes=body.expiry_minutes)),
        "paid_at": None,
        "settled_at": None,
    }
    await db.invoices.insert_one(dict(inv))
    return public_invoice(inv, merchant.get("business_name"))


@api.get("/invoices")
async def list_invoices(merchant: dict = Depends(current_merchant)):
    docs = await db.invoices.find({"merchant_address": merchant["address"]}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d["created_at"], reverse=True)
    return [public_invoice(d, merchant.get("business_name")) for d in docs]


@api.get("/stats")
async def stats(merchant: dict = Depends(current_merchant)):
    docs = await db.invoices.find({"merchant_address": merchant["address"]}, {"_id": 0}).to_list(5000)
    by_status = {}
    settled_sol = 0.0
    pending_sol = 0.0
    for d in docs:
        by_status[d["status"]] = by_status.get(d["status"], 0) + 1
        if d["status"] == "settled":
            settled_sol += d["amount_sol"]
        elif d["status"] in ("paid", "overpaid", "active", "underpaid"):
            pending_sol += d["amount_sol"]
    return {
        "total_invoices": len(docs),
        "by_status": by_status,
        "settled_sol": round(settled_sol, 6),
        "pending_sol": round(pending_sol, 6),
    }


async def _get_owned_invoice(invoice_id: str, merchant: dict) -> dict:
    inv = await db.invoices.find_one({"id": invoice_id, "merchant_address": merchant["address"]}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


@api.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    return public_invoice(inv, merchant.get("business_name"))


@api.get("/invoices/{invoice_id}/open-tx")
async def open_tx(invoice_id: str, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    if inv["status"] not in ("created",):
        raise HTTPException(400, f"Vault already activated (status={inv['status']})")
    merkle_root = bytes.fromhex(inv["merkle_root_hex"])
    ix = sv.open_vault_instruction(merkle_root, inv["bump"], merchant["address"], inv["vault_address"])
    return {
        "instruction": ix,
        "fee_payer": merchant["address"],
        "rent_lamports": sv.VAULT_RENT_LAMPORTS,
        "vault_address": inv["vault_address"],
    }


class SigIn(BaseModel):
    signature: str


@api.post("/invoices/{invoice_id}/confirm-open")
async def confirm_open(invoice_id: str, body: SigIn, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    if inv["status"] != "created":
        raise HTTPException(400, f"Vault already activated (status={inv['status']})")
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "active", "open_tx_sig": body.signature, "rent_baseline": sv.VAULT_RENT_LAMPORTS}},
    )
    inv = await _get_owned_invoice(invoice_id, merchant)
    return public_invoice(inv, merchant.get("business_name"))


async def _refresh_payment(inv: dict) -> dict:
    """Query on-chain balance and transition status accordingly."""
    if inv["status"] in ("settled",):
        return inv
    try:
        balance = await get_balance(inv["vault_address"])
    except Exception as e:
        logger.warning(f"balance check failed for {inv['vault_address']}: {e}")
        return inv

    updates = {"observed_lamports": balance}
    baseline = inv.get("rent_baseline") or 0
    received = max(0, balance - baseline)
    expired = now() > datetime.fromisoformat(inv["expires_at"])

    new_status = inv["status"]
    if inv["status"] in ("active", "created", "underpaid"):
        if received >= inv["amount_lamports"] and inv["amount_lamports"] > 0:
            new_status = "overpaid" if received > inv["amount_lamports"] else "paid"
            if not inv.get("paid_at"):
                updates["paid_at"] = iso(now())
        elif received > 0:
            new_status = "underpaid"
        elif expired:
            new_status = "expired"
    updates["status"] = new_status
    await db.invoices.update_one({"id": inv["id"]}, {"$set": updates})
    inv = {**inv, **updates}
    return inv


@api.post("/invoices/{invoice_id}/check-payment")
async def check_payment(invoice_id: str, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    inv = await _refresh_payment(inv)
    return public_invoice(inv, merchant.get("business_name"))


@api.get("/invoices/{invoice_id}/settle-tx")
async def settle_tx(invoice_id: str, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    if inv.get("key_used") or inv["status"] == "settled":
        raise HTTPException(400, "This vault's one-time key has already been used (settled).")
    if inv["status"] not in ("paid", "overpaid", "active", "underpaid"):
        raise HTTPException(400, f"Vault not ready to settle (status={inv['status']}).")
    payout = merchant["payout_address"]
    priv = fernet.decrypt(inv["wots_privkey_enc"].encode())

    # Refresh balance so a percentage split reflects the latest received amount.
    try:
        balance = await get_balance(inv["vault_address"])
    except Exception:
        balance = inv.get("observed_lamports") or 0
    baseline = inv.get("rent_baseline") or 0
    received = max(0, balance - baseline)

    split_address = inv.get("split_address")
    if split_address:
        # Compute the split recipient's share (in lamports) from the received amount.
        if inv.get("split_type") == "percent":
            split_lamports = int(round((inv["split_value"] / 100.0) * received))
        else:  # fixed SOL amount
            split_lamports = int(round(inv["split_value"] * sv.LAMPORTS_PER_SOL))
        split_lamports = max(0, min(split_lamports, received))
        message = sv.split_message(split_lamports, split_address, payout)
        signature = wots.sign(priv, message)
        if wots.recover_merkle_root(signature, message).hex() != inv["merkle_root_hex"]:
            raise HTTPException(500, "Signature self-verification failed")
        ix = sv.split_vault_instruction(signature, split_lamports, inv["bump"],
                                        inv["vault_address"], split_address, payout)
        return {
            "instruction": ix,
            "fee_payer": payout,
            "payout_address": payout,
            "vault_address": inv["vault_address"],
            "mode": "split",
            "split_address": split_address,
            "split_lamports": split_lamports,
            "split_sol": split_lamports / sv.LAMPORTS_PER_SOL,
            "refund_sol": max(0, received - split_lamports) / sv.LAMPORTS_PER_SOL,
        }

    refund_pubkey_bytes = bytes(Pubkey.from_string(payout))
    signature = wots.sign(priv, refund_pubkey_bytes)
    # Safety: verify the signature recovers to the vault's committed merkle root
    if wots.recover_merkle_root(signature, refund_pubkey_bytes).hex() != inv["merkle_root_hex"]:
        raise HTTPException(500, "Signature self-verification failed")
    ix = sv.close_vault_instruction(signature, inv["bump"], inv["vault_address"], payout)
    return {
        "instruction": ix,
        "fee_payer": payout,
        "payout_address": payout,
        "vault_address": inv["vault_address"],
        "mode": "close",
    }


@api.post("/invoices/{invoice_id}/confirm-settle")
async def confirm_settle(invoice_id: str, body: SigIn, merchant: dict = Depends(current_merchant)):
    inv = await _get_owned_invoice(invoice_id, merchant)
    if inv.get("key_used"):
        raise HTTPException(400, "Key already retired.")
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": "settled", "close_tx_sig": body.signature,
                  "key_used": True, "settled_at": iso(now())}},
    )
    inv = await _get_owned_invoice(invoice_id, merchant)
    return public_invoice(inv, merchant.get("business_name"))


@api.get("/invoices/export/csv")
async def export_csv(merchant: dict = Depends(current_merchant)):
    docs = await db.invoices.find({"merchant_address": merchant["address"]}, {"_id": 0}).to_list(5000)
    docs.sort(key=lambda d: d["created_at"], reverse=True)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Invoice ID", "Created", "Amount SOL", "Memo", "Status", "Vault Address",
                "Received SOL", "Open Tx", "Settle Tx", "Settled At"])
    for d in docs:
        received = max(0, (d.get("observed_lamports") or 0) - (d.get("rent_baseline") or 0)) / sv.LAMPORTS_PER_SOL
        w.writerow([d["id"], d["created_at"], d["amount_sol"], d.get("memo", ""), d["status"],
                    d["vault_address"], received, d.get("open_tx_sig") or "",
                    d.get("close_tx_sig") or "", d.get("settled_at") or ""])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=quantumpos_invoices.csv"})


# ----------------------------- public checkout -----------------------------
@api.get("/checkout/{invoice_id}")
async def checkout_view(invoice_id: str):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    merchant = await db.merchants.find_one({"address": inv["merchant_address"]}, {"_id": 0})
    name = (merchant or {}).get("business_name") or "Merchant"
    return public_invoice(inv, name)


@api.post("/checkout/{invoice_id}/check")
async def checkout_check(invoice_id: str):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv = await _refresh_payment(inv)
    merchant = await db.merchants.find_one({"address": inv["merchant_address"]}, {"_id": 0})
    name = (merchant or {}).get("business_name") or "Merchant"
    return public_invoice(inv, name)


@api.get("/config")
async def config():
    return {
        "cluster": CLUSTER,
        "rpc_url": RPC_URL,
        "program_id": os.environ["VAULT_PROGRAM_ID"],
        "explorer_program": explorer_address(os.environ["VAULT_PROGRAM_ID"]),
        "rent_lamports": sv.VAULT_RENT_LAMPORTS,
    }


@api.get("/")
async def root():
    return {"service": "QuantumPOS", "status": "ok", "cluster": CLUSTER}


# ----------------------------- background watcher -----------------------------
async def watcher_loop():
    await asyncio.sleep(10)
    while True:
        try:
            docs = await db.invoices.find(
                {"status": {"$in": ["active", "created", "underpaid"]}}, {"_id": 0}
            ).to_list(200)
            for d in docs:
                await _refresh_payment(d)
                await asyncio.sleep(1.5)  # be gentle with public RPC
        except Exception as e:
            logger.warning(f"watcher error: {e}")
        await asyncio.sleep(30)


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    await db.challenges.create_index("expires_at", expireAfterSeconds=0)
    asyncio.create_task(watcher_loop())
    logger.info(f"QuantumPOS started on cluster={CLUSTER}")


@app.on_event("shutdown")
async def _shutdown():
    client.close()
