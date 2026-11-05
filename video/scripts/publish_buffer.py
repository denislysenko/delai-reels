#!/usr/bin/env python3
"""Buffer → Instagram Reels (and the other channels Buffer has) through Buffer's GraphQL API.
Buffer never receives the file: it downloads the video from a public direct URL at publish time,
which is why the master goes to Dropbox first (publish_dropbox.py upload).

    python3 scripts/publish_buffer.py check                    # does the key work
    python3 scripts/publish_buffer.py channels                 # id · service · name
    python3 scripts/publish_buffer.py post --channel ID --video URL --text out/post.txt
            [--draft (default) | --now | --at 2026-11-03T09:00:00Z | --queue]
            [--type reel] [--thumb-ms 1500] [--no-feed]
    # carousel: repeat --video in slide order (2–20 items), it goes out as an Instagram post
    python3 scripts/publish_buffer.py post --video URL1 --video URL2 ... --text out/post.txt
    # carousel of pictures (JPEG slides): repeat --image instead, same rules
    python3 scripts/publish_buffer.py post --image URL1 --image URL2 ... --text post.txt
    python3 scripts/publish_buffer.py status POST_ID
    python3 scripts/publish_buffer.py wait POST_ID [--cleanup /reels/<folder>]   # every 5 min until sent/error

The key is BUFFER_API_KEY in video/.env (publish.buffer.com/settings/api); it is never printed.
Free plan: 150 requests per 15 min and 600 a day, shared by every key and MCP on the account —
so `wait` asks once every 5 minutes. Python standard library only.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from publish_dropbox import env  # noqa: E402

API = "https://api.buffer.com"
UA = "delai-reels/1.0"

CREATE_POST = """mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id status dueAt externalLink error { message } } }
    ... on MutationError { message }
  }
}"""
POST_STATE = """query PostState($id: PostId!) {
  post(input: { id: $id }) { id status dueAt sentAt externalLink error { message } }
}"""
ORGS = "query { account { organizations { id name } } }"
CHANNELS = """query Channels($org: OrganizationId!) {
  channels(input: { organizationId: $org }) { id name service }
}"""


def die(msg):
    sys.exit(f"Buffer: {msg}")


def gql(query, variables=None):
    key = env("BUFFER_API_KEY")
    if not key:
        die("нет BUFFER_API_KEY в video/.env (SERVICES.md → Buffer)")
    req = urllib.request.Request(API, data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                          "User-Agent": UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            die("ключ не принят — создай новый на publish.buffer.com/settings/api")
        if e.code == 429:
            die(f"лимит запросов, подожди {e.headers.get('Retry-After', 'немного')} с")
        die(f"ответил {e.code}")
    except urllib.error.URLError:
        die("нет связи")
    if body.get("errors"):
        first = body["errors"][0]
        code = first.get("extensions", {}).get("code", "")
        if code in ("UNAUTHENTICATED", "UNAUTHORIZED"):
            die("ключ не принят — создай новый на publish.buffer.com/settings/api")
        die(first.get("message", "ошибка без текста").replace(key, "<ключ скрыт>"))
    return body["data"]


def channels():
    out = []
    for org in gql(ORGS)["account"]["organizations"]:
        out += gql(CHANNELS, {"org": org["id"]})["channels"]
    return out


def show(post):
    line = f"{post['id']}  {post['status']}"
    if post.get("dueAt"):
        line += f"  на {post['dueAt']}"
    if post.get("externalLink"):
        line += f"  {post['externalLink']}"
    if post.get("error"):
        line += f"  !! {post['error']['message']}"
    print(line, flush=True)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sub.add_parser("channels")
    sp = sub.add_parser("post")
    sp.add_argument("--channel", default=env("BUFFER_CHANNEL_ID"))
    media = sp.add_mutually_exclusive_group(required=True)
    media.add_argument("--video", action="append",
                       help="public direct URL (publish_dropbox.py upload); repeat it for a carousel, in slide order")
    media.add_argument("--image", action="append",
                       help="public direct URL of a picture (JPEG/PNG); repeat it for a carousel, in slide order")
    sp.add_argument("--text", required=True, help="file with the caption")
    when = sp.add_mutually_exclusive_group()
    when.add_argument("--now", action="store_true")
    when.add_argument("--queue", action="store_true", help="next free slot of the Buffer queue")
    when.add_argument("--at", help="ISO 8601 UTC, e.g. 2026-11-03T09:00:00Z")
    sp.add_argument("--type", default="reel", help="Instagram post type: reel / post / story")
    sp.add_argument("--thumb-ms", type=int, help="cover frame, ms from the start of the video")
    sp.add_argument("--no-feed", action="store_true", help="reel only in the Reels tab, not in the feed")
    st = sub.add_parser("status")
    st.add_argument("id")
    wt = sub.add_parser("wait")
    wt.add_argument("id")
    wt.add_argument("--cleanup", help="Dropbox folder to remove once the post is out")
    wt.add_argument("--every", type=int, default=300)
    wt.add_argument("--hours", type=float, default=24)
    a = p.parse_args()

    if a.cmd == "check":
        print(f"works: {len(channels())} channel(s)")
    elif a.cmd == "channels":
        for c in channels():
            print(f"{c['id']}  {c['service']:<10} {c['name']}")
    elif a.cmd == "post":
        if not a.channel:
            die("укажи --channel (publish_buffer.py channels) или BUFFER_CHANNEL_ID в video/.env")
        items = a.video or a.image
        carousel = len(items) > 1
        if carousel and not 2 <= len(items) <= 20:
            die("в карусели Instagram от 2 до 20 элементов")
        if a.thumb_ms is not None and (carousel or a.image):
            die("--thumb-ms только для одного ролика: у карусели обложка — первый слайд")
        if a.video:
            videos = [{"url": url} for url in a.video]
            if a.thumb_ms is not None:
                videos[0]["metadata"] = {"thumbnailOffset": a.thumb_ms}
            assets = [{"video": v} for v in videos]
        else:
            assets = [{"image": {"url": url}} for url in a.image]
        service = next((c["service"] for c in channels() if c["id"] == a.channel), None)
        if service is None:
            die("такого канала нет — publish_buffer.py channels")
        inp = {
            "channelId": a.channel,
            "text": open(a.text).read().strip(),
            "schedulingType": "automatic",
            "assets": assets,
        }
        if service == "instagram":
            # несколько видео — это карусель, а она в Instagram бывает только типа «post»
            kind = "post" if carousel or a.image else a.type
            inp["metadata"] = {"instagram": {"type": kind, "shouldShareToFeed": not a.no_feed}}
        if a.now:
            inp["mode"] = "shareNow"
        elif a.queue:
            inp["mode"] = "addToQueue"
        elif a.at:
            inp["mode"], inp["dueAt"] = "customScheduled", a.at
        else:  # default: a draft — publishing needs the user's explicit yes
            inp["mode"], inp["saveToDraft"] = "addToQueue", True
        res = gql(CREATE_POST, {"input": inp})["createPost"]
        if "post" not in res:
            die(f"не принял пост: {res.get('message', 'без объяснения')}")
        show(res["post"])
        if res["post"]["status"] == "error":
            sys.exit(1)
    elif a.cmd == "status":
        show(gql(POST_STATE, {"id": a.id})["post"])
    elif a.cmd == "wait":
        deadline = time.time() + a.hours * 3600
        while True:
            post = gql(POST_STATE, {"id": a.id})["post"]
            show(post)
            if post["status"] == "sent":
                if a.cleanup:
                    from publish_dropbox import remove
                    remove(a.cleanup)
                    print(f"Dropbox: {a.cleanup} удалена")
                return
            if post["status"] == "error":
                sys.exit(1)
            if post["status"] == "draft":
                die("это черновик, он сам не выйдет — сначала запланируй его в Buffer или через post --at")
            if time.time() > deadline:
                die("пост так и не вышел — проверь в Buffer")
            time.sleep(a.every)


if __name__ == "__main__":
    main()
