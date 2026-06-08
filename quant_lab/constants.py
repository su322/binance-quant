"""Shared constants for event contracts."""
EVENT_DURATION_SECONDS: dict[str, int] = {"10m": 600, "30m": 1800, "1h": 3600, "1d": 86400}
EVENT_PAYOUT_RATES: dict[str, float] = {"10m": 0.8, "30m": 0.85, "1h": 0.85, "1d": 0.85}
