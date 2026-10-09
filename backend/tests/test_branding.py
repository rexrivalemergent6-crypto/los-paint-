"""Tests for optional invoice/merchant branding."""
import os
import base64
import requests
import base58
from nacl.signing import SigningKey

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


def new_wallet():
    sk = SigningKey.generate()
    addr = base58.b58encode(bytes(sk.verify_key)).decode()
    return sk, addr


def login():
    sk, addr = new_wallet()
    r = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr}, timeout=20)
    msg = r.json()["message"]
    sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
    r = requests.post(f"{BASE_URL}/auth/verify",
                      json={"address": addr, "message": msg, "signature": sig}, timeout=20)
    return addr, r.json()["token"]


# small 1x1 transparent PNG data URL
PNG_1x1 = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


class TestBrandingInvoice:
    def test_create_invoice_with_full_branding(self):
        addr, tok = login()
        branding = {
            "name": "TEST_Quantum Coffee",
            "logo": PNG_1x1,
            "accent_color": "#9945FF",
            "tagline": "Hash-based lattes",
            "website": "quantumcoffee.io",   # no scheme; backend should prepend https://
            "socials": {
                "x": "x.com/quantumcoffee",
                "instagram": "instagram.com/quantumcoffee",
                "telegram": "",
                "discord": "https://discord.gg/foo",
            },
        }
        r = requests.post(f"{BASE_URL}/invoices", headers=_headers(tok),
                          json={"amount_sol": 0.1, "memo": "TEST_br", "branding": branding}, timeout=20)
        assert r.status_code == 200, r.text
        inv = r.json()
        b = inv["branding"]
        assert b["name"] == "TEST_Quantum Coffee"
        assert b["logo"].startswith("data:image/png;base64,")
        assert b["accent_color"] == "#9945FF"
        assert b["tagline"] == "Hash-based lattes"
        # URL normalisation
        assert b["website"] == "https://quantumcoffee.io"
        assert b["socials"]["x"] == "https://x.com/quantumcoffee"
        assert b["socials"]["instagram"] == "https://instagram.com/quantumcoffee"
        assert "telegram" not in b["socials"]  # empty dropped
        assert b["socials"]["discord"] == "https://discord.gg/foo"
        # merchant_name mirrors branding.name
        assert inv["merchant_name"] == "TEST_Quantum Coffee"

        # Branding persisted on merchant too (and business_name set)
        r = requests.get(f"{BASE_URL}/auth/me", headers=_headers(tok), timeout=20)
        me = r.json()
        assert me["business_name"] == "TEST_Quantum Coffee"
        assert me["branding"]["accent_color"] == "#9945FF"

        # Public checkout exposes branding
        r = requests.get(f"{BASE_URL}/checkout/{inv['id']}", timeout=20)
        assert r.status_code == 200
        pub = r.json()
        assert pub["merchant_name"] == "TEST_Quantum Coffee"
        assert pub["branding"]["website"] == "https://quantumcoffee.io"
        assert pub["branding"]["accent_color"] == "#9945FF"

    def test_invoice_without_branding_uses_merchant_saved(self):
        addr, tok = login()
        # Save branding on profile
        r = requests.put(f"{BASE_URL}/merchant/profile", headers=_headers(tok),
                         json={"branding": {"name": "TEST_Saved", "accent_color": "#00C2FF"}}, timeout=20)
        assert r.status_code == 200
        assert r.json()["branding"]["name"] == "TEST_Saved"
        # business_name auto-set from branding.name
        assert r.json()["business_name"] == "TEST_Saved"

        # Invoice without branding payload -> inherits merchant branding
        r = requests.post(f"{BASE_URL}/invoices", headers=_headers(tok),
                          json={"amount_sol": 0.05, "memo": "TEST_inherit"}, timeout=20)
        assert r.status_code == 200
        inv = r.json()
        assert inv["branding"]["name"] == "TEST_Saved"
        assert inv["branding"]["accent_color"] == "#00C2FF"
        assert inv["merchant_name"] == "TEST_Saved"

    def test_rejects_non_image_logo(self):
        addr, tok = login()
        r = requests.post(f"{BASE_URL}/invoices", headers=_headers(tok),
                          json={"amount_sol": 0.01,
                                "branding": {"logo": "data:text/plain;base64,SGVsbG8="}},
                          timeout=20)
        assert r.status_code == 400
        assert "image" in r.json()["detail"].lower()

    def test_rejects_bad_hex(self):
        addr, tok = login()
        r = requests.post(f"{BASE_URL}/invoices", headers=_headers(tok),
                          json={"amount_sol": 0.01,
                                "branding": {"accent_color": "not-a-color"}},
                          timeout=20)
        assert r.status_code == 400
        assert "hex" in r.json()["detail"].lower()

    def test_rejects_too_large_logo(self):
        addr, tok = login()
        big = "data:image/png;base64," + ("A" * 400_001)
        r = requests.post(f"{BASE_URL}/invoices", headers=_headers(tok),
                          json={"amount_sol": 0.01, "branding": {"logo": big}},
                          timeout=20)
        assert r.status_code == 400
        assert "large" in r.json()["detail"].lower()


class TestProfileBranding:
    def test_update_profile_branding(self):
        addr, tok = login()
        r = requests.put(f"{BASE_URL}/merchant/profile", headers=_headers(tok),
                         json={"branding": {
                             "name": "TEST_Profile",
                             "accent_color": "#14F195",
                             "website": "https://foo.com",
                             "socials": {"x": "bar.x.com"},
                         }}, timeout=20)
        assert r.status_code == 200
        b = r.json()["branding"]
        assert b["name"] == "TEST_Profile"
        assert b["website"] == "https://foo.com"
        assert b["socials"]["x"] == "https://bar.x.com"

    def test_update_profile_bad_hex(self):
        addr, tok = login()
        r = requests.put(f"{BASE_URL}/merchant/profile", headers=_headers(tok),
                         json={"branding": {"accent_color": "xyz"}}, timeout=20)
        assert r.status_code == 400
