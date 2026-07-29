# ===============================
# backend/auth.py
# Password hashing (PBKDF2, stdlib only) + JWT helpers
# ===============================
import hashlib
import hmac
import os
import base64
import time
import json

SECRET_KEY = os.environ.get("SAAS_SECRET_KEY", "dev-secret-change-me-in-production")
TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12h

# ---------- Password hashing ----------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_b64, dk_b64 = stored_hash.split("$")
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# ---------- Minimal JWT (HS256), no external dependency ----------

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def create_token(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    body = dict(payload)
    body["exp"] = int(time.time()) + TOKEN_TTL_SECONDS
    header_b64 = _b64url_encode(json.dumps(header).encode())
    body_b64 = _b64url_encode(json.dumps(body).encode())
    signing_input = f"{header_b64}.{body_b64}".encode()
    signature = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{header_b64}.{body_b64}.{sig_b64}"


class TokenError(Exception):
    pass


def decode_token(token: str) -> dict:
    try:
        header_b64, body_b64, sig_b64 = token.split(".")
    except ValueError:
        raise TokenError("Token malformado")

    signing_input = f"{header_b64}.{body_b64}".encode()
    expected_sig = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    actual_sig = _b64url_decode(sig_b64)

    if not hmac.compare_digest(expected_sig, actual_sig):
        raise TokenError("Assinatura inválida")

    body = json.loads(_b64url_decode(body_b64))
    if body.get("exp", 0) < time.time():
        raise TokenError("Token expirado")

    return body
