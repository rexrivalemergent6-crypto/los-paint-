"""Tests for Origin-bound SIWS challenge (Phantom domain mismatch fix)."""
import os
import requests
import base58
from nacl.signing import SigningKey

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
AUTH_DOMAIN_FALLBACK = "74e74f53-7c20-4cf9-9858-e2ec2a029901.preview.emergentagent.com"


def new_wallet():
    sk = SigningKey.generate()
    addr = base58.b58encode(bytes(sk.verify_key)).decode()
    return sk, addr


def _lines(msg):
    return msg.splitlines()


class TestChallengeOrigin:
    def test_challenge_binds_to_origin_header(self):
        _, addr = new_wallet()
        origin = "https://example-merchant.com"
        r = requests.post(f"{BASE_URL}/auth/challenge",
                          json={"address": addr},
                          headers={"Origin": origin},
                          timeout=20)
        assert r.status_code == 200
        msg = r.json()["message"]
        lines = _lines(msg)
        # First line: "<domain> wants you to sign in with your Solana account:"
        assert lines[0].startswith("example-merchant.com wants you to sign in")
        # URI line
        uri_line = next(l for l in lines if l.startswith("URI: "))
        assert uri_line.strip() == "URI: https://example-merchant.com"
        # Chain ID should be solana:mainnet
        chain_line = next(l for l in lines if l.startswith("Chain ID:"))
        assert chain_line.strip() == "Chain ID: solana:mainnet"

    def test_challenge_http_origin(self):
        _, addr = new_wallet()
        origin = "http://localhost:3000"
        r = requests.post(f"{BASE_URL}/auth/challenge",
                          json={"address": addr},
                          headers={"Origin": origin},
                          timeout=20)
        assert r.status_code == 200
        msg = r.json()["message"]
        assert msg.splitlines()[0].startswith("localhost:3000 wants you to sign in")
        uri = next(l for l in msg.splitlines() if l.startswith("URI: "))
        assert uri.strip() == "URI: http://localhost:3000"

    def test_challenge_fallback_without_origin(self):
        _, addr = new_wallet()
        # requests does not auto-set Origin; we also explicitly ensure absent
        r = requests.post(f"{BASE_URL}/auth/challenge",
                          json={"address": addr},
                          timeout=20)
        assert r.status_code == 200
        msg = r.json()["message"]
        assert msg.splitlines()[0].startswith(f"{AUTH_DOMAIN_FALLBACK} wants you to sign in")
        uri = next(l for l in msg.splitlines() if l.startswith("URI: "))
        assert uri.strip() == f"URI: https://{AUTH_DOMAIN_FALLBACK}"

    def test_challenge_ignores_bogus_origin(self):
        _, addr = new_wallet()
        # Non-http(s) scheme -> fallback
        r = requests.post(f"{BASE_URL}/auth/challenge",
                          json={"address": addr},
                          headers={"Origin": "null"},
                          timeout=20)
        assert r.status_code == 200
        msg = r.json()["message"]
        assert msg.splitlines()[0].startswith(f"{AUTH_DOMAIN_FALLBACK} wants you to sign in")


class TestVerifyWithOrigin:
    def test_full_login_with_origin_header(self):
        sk, addr = new_wallet()
        origin = "https://custom-merchant.app"
        r = requests.post(f"{BASE_URL}/auth/challenge",
                          json={"address": addr},
                          headers={"Origin": origin}, timeout=20)
        assert r.status_code == 200
        msg = r.json()["message"]
        assert "custom-merchant.app" in msg.splitlines()[0]

        sig = base58.b58encode(sk.sign(msg.encode()).signature).decode()
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": msg, "signature": sig},
                          timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 0
        assert data["merchant"]["address"] == addr

        # /auth/me works with returned token
        r = requests.get(f"{BASE_URL}/auth/me",
                         headers={"Authorization": f"Bearer {data['token']}"},
                         timeout=20)
        assert r.status_code == 200
        assert r.json()["address"] == addr

    def test_tampered_signature_still_401(self):
        sk, addr = new_wallet()
        origin = "https://custom-merchant.app"
        msg = requests.post(f"{BASE_URL}/auth/challenge",
                            json={"address": addr},
                            headers={"Origin": origin}, timeout=20).json()["message"]
        good = sk.sign(msg.encode()).signature
        tampered = bytearray(good); tampered[0] ^= 0x01
        sig = base58.b58encode(bytes(tampered)).decode()
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": msg, "signature": sig},
                          timeout=20)
        assert r.status_code == 401

    def test_replay_different_origin_consumed(self):
        """Two different challenges issued (different origins) - second one not used for verify of first message."""
        sk, addr = new_wallet()
        m1 = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr},
                           headers={"Origin": "https://a.com"}, timeout=20).json()["message"]
        _ = requests.post(f"{BASE_URL}/auth/challenge", json={"address": addr},
                          headers={"Origin": "https://b.com"}, timeout=20).json()["message"]
        sig = base58.b58encode(sk.sign(m1.encode()).signature).decode()
        r = requests.post(f"{BASE_URL}/auth/verify",
                          json={"address": addr, "message": m1, "signature": sig}, timeout=20)
        # First challenge still valid (both stored)
        assert r.status_code == 200
        # Replay same message -> 401
        r2 = requests.post(f"{BASE_URL}/auth/verify",
                           json={"address": addr, "message": m1, "signature": sig}, timeout=20)
        assert r2.status_code == 401
