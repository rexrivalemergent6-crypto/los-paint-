import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getPhantom } from "./phantom";
import { API } from "./api";

// Browser -> our backend proxy -> Solana RPC. The public mainnet RPC rejects browser
// origins with 403 "Access forbidden", so all reads go through /api/rpc.
const PROXY_RPC = `${API}/rpc`;
let _conn = null;

export function initConnection() {
  if (!_conn) {
    _conn = new Connection(PROXY_RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
  }
  return _conn;
}

export function getConnection() {
  return _conn || initConnection();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HTTP polling confirmation (no websocket needed through the proxy).
async function confirmByPolling(conn, signature, lastValidBlockHeight, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await conn.getSignatureStatuses([signature]);
      const st = value?.[0];
      if (st?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
      const h = await conn.getBlockHeight("confirmed");
      if (h > lastValidBlockHeight) throw new Error("Transaction expired before confirming — please retry");
    } catch (e) {
      if (/failed on-chain|expired/.test(e.message)) throw e;
    }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for confirmation — check the explorer, then refresh");
}

function ixFromDescriptor(desc) {
  return new TransactionInstruction({
    programId: new PublicKey(desc.programId),
    keys: desc.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(desc.data, "base64"),
  });
}

async function buildAndSend(instructions, feePayer, computeUnits) {
  const conn = getConnection();
  const p = getPhantom();
  if (!p) throw new Error("Phantom not found");
  const tx = new Transaction();
  if (computeUnits) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  }
  instructions.forEach((ix) => tx.add(ix));
  tx.feePayer = new PublicKey(feePayer);
  let blockhash, lastValidBlockHeight;
  try {
    ({ blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed"));
  } catch (e) {
    throw new Error(`Could not reach Solana network: ${e?.message || e}`);
  }
  tx.recentBlockhash = blockhash;
  const { signature } = await p.signAndSendTransaction(tx);
  await confirmByPolling(conn, signature, lastValidBlockHeight);
  return signature;
}

// Merchant opens a vault (pays rent + fee). ~34-byte instruction.
export async function sendOpenVault(descriptor, feePayer) {
  return buildAndSend([ixFromDescriptor(descriptor.instruction)], feePayer, 200000);
}

// Merchant closes a vault (one-time WOTS sig). Heavy keccak -> high CU limit.
export async function sendCloseVault(descriptor, feePayer) {
  return buildAndSend([ixFromDescriptor(descriptor.instruction)], feePayer, 1000000);
}

// Customer pays SOL to the vault address (plain system transfer).
export async function sendPayment(fromPubkey, vaultAddress, lamports) {
  const ix = SystemProgram.transfer({
    fromPubkey: new PublicKey(fromPubkey),
    toPubkey: new PublicKey(vaultAddress),
    lamports,
  });
  return buildAndSend([ix], fromPubkey, null);
}
