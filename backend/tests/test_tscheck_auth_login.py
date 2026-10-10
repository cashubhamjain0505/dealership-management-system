"""Criterion: Staff login gates the whole app; wrong password rejected."""

import httpx


def test_login_success_and_session(client: httpx.Client):
    resp = client.post("/auth/login", json={"password": "suzuki123", "staff_name": "tscheck-auth-ok"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body.get("logged_in") is True
    assert body.get("staff_name") == "tscheck-auth-ok"
    # Session cookie now lets us hit a protected route.
    me = client.get("/auth/me")
    assert me.status_code == 200, me.text
    assert me.json().get("staff_name") == "tscheck-auth-ok"


def test_login_wrong_password_rejected():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as c:
        resp = c.post("/auth/login", json={"password": "wrong-password-xyz", "staff_name": "tscheck-auth-bad"})
        assert resp.status_code in (401, 403), resp.text
        # No session cookie should have been set -> protected route stays gated.
        gated = c.get("/items")
        assert gated.status_code in (401, 403), gated.text


def test_protected_route_requires_session():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as c:
        resp = c.get("/items")
        assert resp.status_code in (401, 403), resp.text
