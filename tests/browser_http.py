"""HTTP browser regression for stable logical operation IDs.

The first command response is deliberately discarded after the server commits.
The second click must replay the same operation instead of creating a duplicate.
Uses only fictional sandbox state; no wallet or provider is involved.
"""
from pathlib import Path
import json, os, socket, subprocess, tempfile, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def get_state(base):
    with urllib.request.urlopen(base + "/api/state") as response:
        return json.load(response)["state"]

def assert_static_asset(base, path, expected_type):
    """Ensure server-side module routes match the offline bundle's imports."""
    with urllib.request.urlopen(base + path) as response:
        assert response.status == 200
        assert response.headers.get_content_type() == expected_type
        assert response.read(64)

def login_browser_admin(base, context):
    """Seed a test-only admin session into the browser context.

    The application correctly marks admin cookies Secure, while this regression
    server is plain HTTP.  Login through urllib and re-add only the test
    session cookies as non-Secure localhost cookies; never weaken production
    cookie policy just to make the browser test pass.
    """
    payload = json.dumps({"email": "admin@example.test", "password": "admin-test-password"}).encode()
    request = urllib.request.Request(
        base + "/api/admin/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        assert response.status == 200
        cookies = []
        for header in response.headers.get_all("Set-Cookie") or []:
            pair = header.split(";", 1)[0]
            name, value = pair.split("=", 1)
            cookies.append({
                "name": name,
                "value": urllib.parse.unquote(value),
                "domain": "127.0.0.1",
                "path": "/",
                "secure": False,
            })
        assert {cookie["name"] for cookie in cookies} >= {"eg_admin_session", "eg_admin_csrf"}
        context.add_cookies(cookies)

def main():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="escrow-global-http-") as directory:
        data_file = str(Path(directory) / "sandbox.json")
        env = {**os.environ, "PORT": str(port), "DATA_FILE": data_file, "ESCROW_MODE": "sandbox",
               "ADMIN_EMAIL": "admin@example.test",
               "ADMIN_PASSWORD_HASH": "scrypt$16384$8$1$ZXNjcm93LWdsb2JhbC10ZXN0LXNhbHQ=$JO/w47OW1LIQckv5IpSwTiXhjjZ3BIwHXm/+fkAsqtg="}
        process = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                try:
                    before = get_state(base)
                    break
                except Exception:
                    time.sleep(0.05)
            else:
                raise RuntimeError("sandbox server did not start")

            assert_static_asset(base, "/tutorial-visuals.mjs", "text/javascript")
            assert_static_asset(base, "/admin.css", "text/css")

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(viewport={"width": 1280, "height": 900})
                page = context.new_page()
                page.set_default_timeout(10000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "/#/service/web", wait_until="domcontentloaded", timeout=10000)
                try:
                    page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass
                if not page.locator("[data-action=checkout]").count():
                    raise AssertionError(f"service page did not render checkout: url={page.url} text={page.locator('body').inner_text()[:1000]} errors={errors}")
                page.locator("[data-action=checkout]").first.click()
                dialog = page.locator("#pact-dialog")
                dialog.locator("[name=requirements]").fill(
                    "Fictional HTTP retry agreement with exact requirements and acceptance tests."
                )
                dialog.locator("[name=consent]").check()

                def discard_first_response(route):
                    route.fetch()
                    route.abort(error_code="failed")

                page.route("**/api/command", discard_first_response, times=1)
                dialog.locator("[type=submit]").click()
                dialog.locator(".form-error").get_by_text("Failed to fetch", exact=False).wait_for()
                after_lost_response = get_state(base)
                assert len(after_lost_response["orders"]) == len(before["orders"]) + 1

                with page.expect_request("**/api/command"):
                    dialog.locator("[type=submit]").click()
                page.wait_for_url("**/#/deal/**")
                after_retry = get_state(base)
                assert len(after_retry["orders"]) == len(before["orders"]) + 1
                assert not errors, errors
                login_browser_admin(base, context)
                admin = context.new_page()
                admin.goto(base + "/admin#readiness", wait_until="domcontentloaded", timeout=10000)
                admin.wait_for_selector(".readiness-panel")
                assert "Production custody gateboard" in admin.locator("body").inner_text()
                assert "BLOCKED" in admin.locator("body").inner_text()
                admin.close()
                context.close()
                browser.close()
            print(json.dumps({"passed": 1, "ordersBefore": len(before["orders"]),
                              "afterLostResponse": len(after_lost_response["orders"]),
                              "afterRetry": len(after_retry["orders"])}))
        finally:
            process.terminate()
            process.wait(timeout=10)

if __name__ == "__main__":
    main()
