"""Validated Homebox authentication for paid/local audio transcription work."""

from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import Depends, HTTPException

from homebox_companion import HomeboxAuthError, HomeboxClient
from server.dependencies import get_client, get_token


async def require_valid_homebox_token(
    token: Annotated[str, Depends(get_token)],
    client: Annotated[HomeboxClient, Depends(get_client)],
) -> str:
    """Validate a Homebox bearer token before constructing a provider client.

    This deliberately reuses Homebox as the source of truth. It exists as a
    route-local dependency because transcription performs paid/local work but
    otherwise makes no Homebox request that would validate the token.
    """
    try:
        valid = await client.validate_token(token)
    except HomeboxAuthError as error:
        raise HTTPException(status_code=401, detail="Invalid or expired Homebox token") from error
    except (httpx.TimeoutException, httpx.NetworkError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail="Authentication service unavailable") from error

    if not valid:
        raise HTTPException(status_code=401, detail="Invalid or expired Homebox token")
    return token
