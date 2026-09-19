import os
from functools import lru_cache

from supabase import Client, create_client
from supabase.lib.client_options import ClientOptions


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for Supabase integration.")
    return value


@lru_cache(maxsize=1)
def get_supabase_public_client() -> Client:
    """Client for Auth/token verification using the publishable project key."""
    return create_client(
        _required_env("SUPABASE_URL"),
        _required_env("SUPABASE_PUBLISHABLE_KEY"),
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
        ),
    )


@lru_cache(maxsize=1)
def get_supabase_admin_client() -> Client:
    """Trusted backend client. Never expose SUPABASE_SECRET_KEY to the frontend."""
    return create_client(
        _required_env("SUPABASE_URL"),
        _required_env("SUPABASE_SECRET_KEY"),
        options=ClientOptions(
            auto_refresh_token=False,
            persist_session=False,
        ),
    )


def verify_access_token(access_token: str):
    """Validate a Supabase user JWT against Auth and return the verified user."""
    token = (access_token or "").strip()
    if not token:
        raise ValueError("Missing Supabase access token.")

    response = get_supabase_public_client().auth.get_user(token)
    if response.user is None:
        raise ValueError("Invalid Supabase access token.")
    return response.user
