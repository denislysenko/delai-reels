#!/usr/bin/env python3
"""Dropbox as the public shelf for a finished video: Buffer takes media only by URL and downloads
it itself, so the master has to sit somewhere reachable from the open internet. A Dropbox app with
"App folder" access sees only its own folder; its direct links (dl.dropboxusercontent.com) give the
file itself, no preview page and no redirect, which is what Buffer and Instagram need.

    python3 scripts/publish_dropbox.py login             # sign-in link; the code goes into video/.env
    python3 scripts/publish_dropbox.py connect           # code → permanent refresh token in video/.env
    python3 scripts/publish_dropbox.py check             # does access work
    python3 scripts/publish_dropbox.py upload out/final-master.mp4 [folder]   # → direct link, last line
    python3 scripts/publish_dropbox.py remove /reels/<folder>                 # after the post is out

Keys live in video/.env only (DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_AUTH_CODE,
DROPBOX_REFRESH_TOKEN). Nothing here prints them; errors carry Dropbox's error_summary only.
Python standard library only.
"""
import base64, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # video/
ENV = os.path.join(here, ".env")
API = "https://api.dropboxapi.com"
CONTENT = "https://content.dropboxapi.com"
CHUNK = 64 * 1024 * 1024  # files above this go through an upload session (single call caps at 150 MB)
UA = "delai-reels/1.0"


def env(name):
    """A value from video/.env without ever printing it."""
    try:
        for line in open(ENV):
            k, _, v = line.strip().partition("=")
            if k == name:
                return v.strip().strip('"')
    except FileNotFoundError:
        pass
    return ""


def env_set(name, value):
    """Write or replace one line of video/.env, leaving every other line as it was."""
    lines = open(ENV).read().splitlines() if os.path.exists(ENV) else []
    out, done = [], False
    for line in lines:
        if line.split("=", 1)[0].strip() == name:
            out.append(f"{name}={value}")
            done = True
        else:
            out.append(line)
    if not done:
        out.append(f"{name}={value}")
    open(ENV, "w").write("\n".join(out) + "\n")


def die(msg):
    sys.exit(f"Dropbox: {msg}")


def http(url, headers, body=None):
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read().decode() or "null"
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:200]
    except urllib.error.URLError:
        die("нет связи с Dropbox")


def summary(data):
    if isinstance(data, dict):
        return data.get("error_summary") or data.get("error_description") or data.get("error") or "ошибка без текста"
    return str(data)


def token_request(params):
    key, secret = env("DROPBOX_APP_KEY"), env("DROPBOX_APP_SECRET")
    if not key or not secret:
        die("впиши DROPBOX_APP_KEY и DROPBOX_APP_SECRET в video/.env (SERVICES.md → Dropbox)")
    basic = base64.b64encode(f"{key}:{secret}".encode()).decode()
    status, data = http(f"{API}/oauth2/token",
                        {"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
                        urllib.parse.urlencode(params).encode())
    if status != 200:
        reason = summary(data)
        if reason == "invalid_grant":
            reason = "код входа устарел или уже использован — получи новый: publish_dropbox.py login"
        elif reason == "invalid_client":
            reason = "неверный App key или App secret"
        die(f"не пустил: {reason}")
    return data


_access = None


def access_token():
    global _access
    if _access is None:
        refresh = env("DROPBOX_REFRESH_TOKEN")
        if not refresh:
            die("вход не выполнен — publish_dropbox.py login, потом connect")
        _access = token_request({"grant_type": "refresh_token", "refresh_token": refresh})["access_token"]
    return _access


def arg(value):
    """Dropbox-API-Arg must be ASCII: escape the rest."""
    return re.sub(r"[\u007f-￿]", lambda m: "\\u%04x" % ord(m.group()), json.dumps(value))


def rpc(path, payload):
    return http(f"{API}{path}", {"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json"},
                json.dumps(payload).encode())


def content(path, api_arg, body):
    return http(f"{CONTENT}{path}", {"Authorization": f"Bearer {access_token()}",
                                     "Content-Type": "application/octet-stream", "Dropbox-API-Arg": arg(api_arg)}, body)


def direct(shared):
    """Share link → the file itself: same path and rlkey on dl.dropboxusercontent.com, no dl=0."""
    u = urllib.parse.urlsplit(shared)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query) if k not in ("dl", "raw")]
    return urllib.parse.urlunsplit((u.scheme, "dl.dropboxusercontent.com", u.path, urllib.parse.urlencode(q), ""))


def upload(local, dest):
    size = os.path.getsize(local)
    with open(local, "rb") as f:
        if size <= CHUNK:
            status, data = content("/2/files/upload", {"path": dest, "mode": "overwrite", "mute": True}, f.read())
        else:
            status, data = content("/2/files/upload_session/start", {"close": False}, f.read(CHUNK))
            if status != 200:
                die(f"не начал загрузку: {summary(data)}")
            session, offset = data["session_id"], CHUNK
            while size - offset > CHUNK:
                status, data = content("/2/files/upload_session/append_v2",
                                       {"cursor": {"session_id": session, "offset": offset}, "close": False}, f.read(CHUNK))
                if status != 200:
                    die(f"оборвал загрузку: {summary(data)}")
                offset += CHUNK
                print(f"  {offset * 100 // size}%", file=sys.stderr, flush=True)
            status, data = content("/2/files/upload_session/finish",
                                   {"cursor": {"session_id": session, "offset": offset},
                                    "commit": {"path": dest, "mode": "overwrite", "mute": True}}, f.read())
    if status != 200:
        die(f"не принял файл: {summary(data)}")


def public_link(path):
    status, data = rpc("/2/sharing/create_shared_link_with_settings",
                       {"path": path, "settings": {"requested_visibility": "public", "audience": "public", "access": "viewer"}})
    if status == 200:
        return direct(data["url"])
    existing = (data.get("error", {}) if isinstance(data, dict) else {}).get("shared_link_already_exists", {})
    if existing.get("metadata", {}).get("url"):
        return direct(existing["metadata"]["url"])
    status2, listed = rpc("/2/sharing/list_shared_links", {"path": path, "direct_only": True})
    if status2 == 200 and listed.get("links"):
        return direct(listed["links"][0]["url"])
    die(f"не дал ссылку: {summary(data)} — проверь права sharing.write и sharing.read у приложения")


def remove(path):
    status, data = rpc("/2/files/delete_v2", {"path": path})
    if status != 200 and "not_found" not in summary(data):
        die(f"не удалил {path}: {summary(data)}")


def account():
    status, data = http(f"{API}/2/users/get_current_account", {"Authorization": f"Bearer {access_token()}"})
    if status != 200:
        die(f"не отдал аккаунт: {summary(data)}")
    return data.get("name", {}).get("display_name") or "аккаунт Dropbox"


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "login":
        key = env("DROPBOX_APP_KEY")
        if not key:
            die("сначала впиши DROPBOX_APP_KEY и DROPBOX_APP_SECRET в video/.env")
        q = urllib.parse.urlencode({"client_id": key, "response_type": "code", "token_access_type": "offline"})
        print(f"https://www.dropbox.com/oauth2/authorize?{q}")
        print("Открой ссылку, разреши доступ и впиши показанный код в video/.env строкой DROPBOX_AUTH_CODE=…,"
              " потом: python3 scripts/publish_dropbox.py connect")
    elif cmd == "connect":
        code = env("DROPBOX_AUTH_CODE")
        if not code:
            die("нет DROPBOX_AUTH_CODE в video/.env — publish_dropbox.py login")
        data = token_request({"grant_type": "authorization_code", "code": code})
        if not data.get("refresh_token"):
            die("Dropbox не выдал постоянный ключ — войди по ссылке из login ещё раз")
        # the old token stays until the new one is in hand: a failed exchange never breaks a working login
        env_set("DROPBOX_REFRESH_TOKEN", data["refresh_token"])
        env_set("DROPBOX_AUTH_CODE", "")
        print(f"Dropbox подключён: {account()}")
    elif cmd == "check":
        print(f"works: {account()}")
    elif cmd == "upload" and len(sys.argv) > 2:
        local = sys.argv[2]
        folder = sys.argv[3] if len(sys.argv) > 3 else time.strftime("%Y-%m-%d_%H-%M")
        dest = f"/reels/{folder}/{os.path.basename(local)}"
        upload(local, dest)
        print(f"dropbox path: /reels/{folder}")
        print(public_link(dest))
    elif cmd == "remove" and len(sys.argv) > 2:
        remove(sys.argv[2])
        print(f"удалено: {sys.argv[2]}")
    else:
        sys.exit(__doc__)
