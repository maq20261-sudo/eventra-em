import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, password):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def consumer(api):
    return _login(api, "demo@consumer.com", "password123")


@pytest.fixture(scope="session")
def organizer(api):
    return _login(api, "demo@organizer.com", "password123")


@pytest.fixture(scope="session")
def consumer_headers(consumer):
    return {"Authorization": f"Bearer {consumer['access_token']}"}


@pytest.fixture(scope="session")
def organizer_headers(organizer):
    return {"Authorization": f"Bearer {organizer['access_token']}"}
