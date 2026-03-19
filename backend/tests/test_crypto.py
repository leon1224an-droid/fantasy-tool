"""Tests for backend/crypto.py — field-level Fernet encryption."""

import importlib
import os

import pytest


def _reload_crypto(key: str):
    """Set FIELD_ENCRYPTION_KEY and reload the module so _fernet is rebuilt."""
    os.environ["FIELD_ENCRYPTION_KEY"] = key
    import backend.crypto as m
    importlib.reload(m)
    return m


class TestNoKey:
    """When FIELD_ENCRYPTION_KEY is not set, values pass through unchanged."""

    def setup_method(self):
        self.m = _reload_crypto("")

    def test_encrypt_returns_plaintext(self):
        assert self.m.encrypt_field("mytoken") == "mytoken"

    def test_decrypt_returns_plaintext(self):
        assert self.m.decrypt_field("mytoken") == "mytoken"

    def test_roundtrip(self):
        assert self.m.decrypt_field(self.m.encrypt_field("abc123")) == "abc123"


class TestWithKey:
    """When FIELD_ENCRYPTION_KEY is set, values are encrypted/decrypted."""

    def setup_method(self):
        from cryptography.fernet import Fernet
        key = Fernet.generate_key().decode()
        self.m = _reload_crypto(key)

    def test_encrypt_produces_ciphertext(self):
        ct = self.m.encrypt_field("mytoken")
        assert ct != "mytoken"
        assert ct.startswith("gAAAAA")  # Fernet token prefix

    def test_roundtrip(self):
        ct = self.m.encrypt_field("super-secret-refresh-token")
        assert self.m.decrypt_field(ct) == "super-secret-refresh-token"

    def test_empty_string_roundtrip(self):
        ct = self.m.encrypt_field("")
        assert self.m.decrypt_field(ct) == ""

    def test_different_ciphertexts_each_call(self):
        """Fernet uses a random IV — same plaintext yields different ciphertext."""
        ct1 = self.m.encrypt_field("token")
        ct2 = self.m.encrypt_field("token")
        assert ct1 != ct2

    def test_decrypt_plaintext_fallback(self):
        """
        Tokens stored before encryption was enabled are plaintext.
        decrypt_field must return them as-is rather than raising.
        """
        result = self.m.decrypt_field("plaintext-token-stored-before-encryption")
        assert result == "plaintext-token-stored-before-encryption"

    def test_wrong_key_falls_back(self):
        """
        If a token was encrypted with a different key (e.g. key rotation),
        decrypt_field returns the raw value rather than crashing.
        """
        from cryptography.fernet import Fernet
        other_key = Fernet.generate_key().decode()
        other_m = _reload_crypto(other_key)
        ct = other_m.encrypt_field("token")

        # Reload with original key (self.m is stale after _reload_crypto above)
        from cryptography.fernet import Fernet as F
        current_key = F.generate_key().decode()
        current_m = _reload_crypto(current_key)

        # Should fall back, not raise
        result = current_m.decrypt_field(ct)
        assert isinstance(result, str)
