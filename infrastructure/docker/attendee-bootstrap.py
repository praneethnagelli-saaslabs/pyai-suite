#!/usr/bin/env python3
"""Idempotent local Attendee user + API key for Docker Compose.

Writes the raw token to /shared/attendee_api_key (mode 0600).
Never prints the token, password, or key hash.
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

KEY_PATH = Path(os.environ.get("ATTENDEE_BOOTSTRAP_KEY_FILE", "/shared/attendee_api_key"))
EMAIL = (os.environ.get("ATTENDEE_BOOTSTRAP_EMAIL") or "calliq@local.test").strip()
PASSWORD = os.environ.get("ATTENDEE_BOOTSTRAP_PASSWORD") or "pyai-local-dev-only"
KEY_NAME = os.environ.get("ATTENDEE_BOOTSTRAP_KEY_NAME") or "pyai-suite-compose"


def _write_secret(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    try:
        fd = os.open(path, flags, stat.S_IRUSR | stat.S_IWUSR)
    except PermissionError:
        print(
            f"attendee-bootstrap: cannot write {path} (uid={os.getuid()}). "
            "The Compose volume must be owned by uid 1000 (attendee-key-init).",
            file=sys.stderr,
        )
        raise
    try:
        os.write(fd, value.encode("utf-8"))
    finally:
        os.close(fd)


def _ensure_project_on_path() -> None:
    """`python /bootstrap.py` puts `/` on sys.path; Attendee lives in /attendee."""
    for root in (Path.cwd(), Path("/attendee"), Path("/app")):
        if (root / "manage.py").is_file():
            resolved = str(root.resolve())
            if resolved not in sys.path:
                sys.path.insert(0, resolved)
            os.chdir(root)
            return
    print("attendee-bootstrap: manage.py not found", file=sys.stderr)


def main() -> int:
    skip = (os.environ.get("ATTENDEE_SKIP_BOOTSTRAP") or "").strip().lower()
    if skip in {"1", "true", "yes"}:
        print("attendee-bootstrap: skipped")
        return 0

    _ensure_project_on_path()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "attendee.settings.development")
    import django
    from django.conf import settings

    if not settings.configured:
        django.setup()

    from allauth.account.models import EmailAddress
    from bots.models import ApiKey, Project
    from django.contrib.auth import get_user_model

    User = get_user_model()
    if not EMAIL or "@" not in EMAIL:
        print("attendee-bootstrap: invalid ATTENDEE_BOOTSTRAP_EMAIL", file=sys.stderr)
        return 1

    if KEY_PATH.is_file() and KEY_PATH.stat().st_size > 0 and User.objects.filter(email=EMAIL).exists():
        print("attendee-bootstrap: existing user + key file, skipping")
        return 0

    user = User.objects.filter(email=EMAIL).first()
    created_user = False
    if user is None:
        user = User(email=EMAIL, is_active=True)
        user.set_password(PASSWORD)
        user.save()
        created_user = True

    EmailAddress.objects.update_or_create(
        user=user,
        email=EMAIL,
        defaults={"verified": True, "primary": True},
    )

    project = Project.objects.filter(organization=user.organization).first()
    if project is None:
        project = Project.objects.create(
            name=f"{EMAIL}'s project",
            organization=user.organization,
        )

    _instance, raw = ApiKey.create(project, KEY_NAME)
    if not raw:
        print("attendee-bootstrap: ApiKey.create returned empty token", file=sys.stderr)
        return 1
    _write_secret(KEY_PATH, raw)
    print(
        "attendee-bootstrap: "
        + ("created user + " if created_user else "")
        + "API key written for Compose (not logged)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
