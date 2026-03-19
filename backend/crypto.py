"""
Field-level encryption for sensitive data stored in the database (Yahoo tokens).

Set FIELD_ENCRYPTION_KEY in your environment to a URL-safe base64-encoded 32-byte key.
Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If the key is not set, values are stored/returned as plaintext with a startup warning.
"""

import os
import warnings

from cryptography.fernet import Fernet, InvalidToken

_raw_key = os.getenv("FIELD_ENCRYPTION_KEY", "")

if _raw_key:
    _fernet: Fernet | None = Fernet(_raw_key.encode())
else:
    _fernet = None
    warnings.warn(
        "FIELD_ENCRYPTION_KEY is not set — Yahoo tokens will be stored in plaintext. "
        "Set this variable before deploying to production.",
        stacklevel=1,
    )


def encrypt_field(value: str) -> str:
    """Encrypt a plaintext string. Returns ciphertext string (or plaintext if no key)."""
    if not _fernet:
        return value
    return _fernet.encrypt(value.encode()).decode()


def decrypt_field(value: str) -> str:
    """Decrypt a ciphertext string. Returns plaintext (or the value as-is if no key).

    If decryption fails (e.g. the value was stored before encryption was enabled),
    returns the original value so existing plaintext tokens still work.
    """
    if not _fernet:
        return value
    try:
        return _fernet.decrypt(value.encode()).decode()
    except (InvalidToken, Exception):
        # Graceful fallback: token was stored before encryption was enabled
        return value
