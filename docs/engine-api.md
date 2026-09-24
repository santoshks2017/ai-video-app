# The engine API

A prompt in, a file out. `/v1` is this app's generation engine with none of its
workflow: no briefs, no storyboards, no clients, no vehicle library. Another app
sends words and, if it has them, a few reference pictures or clips, and gets back
a picture or a film.

- **Base** — `https://ava-api-ofnw2ufkwa-el.a.run.app/v1` (live).
  The preview build answers on the same paths at `https://preview---ava-api-ofnw2ufkwa-el.a.run.app/v1`.
- **Key** — `Authorization: Bearer ava_live_…`, made under **APIs & models → Engine
  keys**. A key is shown once. Each one can be switched off, given a daily limit
  in rupees, and allowed pictures, films or both.
- **Answers** — JSON. An error is `{ "error": { "code": "…", "message": "…" } }`
  with the matching HTTP status.
- **Files** — every file comes back as a URL on this service. The links are
  permanent and need no key, so they can be saved, embedded or handed on.

## A picture — while you wait

`POST /v1/images`

| Field | | |
| --- | --- | --- |
| `prompt` | string, required | What to draw. Up to 4,000 characters. |
| `references` | array, optional | Up to 6 pictures: `{ "url": "https://…" }` or `{ "data": "data:image/jpeg;base64,…" }`, each with an optional `label` the model is told. 15 MB each. |
| `aspect` | optional | `1:1` (default), `3:2`, `2:3`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`. |
| `size` | optional | `1K`, `2K` (default), `4K`. |
| `metadata` | optional | Anything you want back with the answer. |

```bash
curl https://ava-api-ofnw2ufkwa-el.a.run.app/v1/images \
  -H "Authorization: Bearer $AVA_KEY" -H "content-type: application/json" \
  -d '{"prompt":"A red Renault Kiger outside a lit showroom at dusk","aspect":"4:5"}'
```

```jsonc
{
  "id": "img_…",
  "object": "image",
  "model": "gemini-3.1-flash-image",
  "aspect": "4:5",
  "url": "https://…/v1/files/…/image.png",
  "mimeType": "image/png",
  "bytes": 2314567,
  "cost": { "inr": 9.06 }
}
```

It takes roughly ten to thirty seconds, and the request stays open for it.

## A film — ask, then ask again

A film takes minutes, so `POST /v1/videos` answers `202` with an id and a URL to
ask at. Ask every few seconds until `status` is `done` or `failed`.

| Field | | |
| --- | --- | --- |
| `prompt` | string, required | What happens on screen. |
| `references` | array, optional | Up to 6 pictures and 3 clips, same shape as above. |
| `seconds` | optional | 1 to 30. Default 8. Longer than the model draws in one go is made in parts, each carrying on from the last frame, and joined. |
| `aspect` | optional | `16:9` (default), `9:16`, `1:1`. |
| `resolution` | optional | `720p`, `1080p` (default). |
| `metadata` | optional | Returned with every answer about this film. |

```bash
curl https://ava-api-ofnw2ufkwa-el.a.run.app/v1/videos \
  -H "Authorization: Bearer $AVA_KEY" -H "content-type: application/json" \
  -d '{"prompt":"The car drives past the camera on a wet street","seconds":16}'
# → { "id": "vid_…", "status": "queued", "poll": "https://…/v1/videos/vid_…" }

curl https://…/v1/videos/vid_… -H "Authorization: Bearer $AVA_KEY"
# → { "status": "running", "parts": { "done": 1, "total": 2 } }
# → { "status": "done", "url": "https://…/v1/files/…/video.mp4", "cost": { "inr": 240 } }
```

`status` is `queued`, `running`, `done` or `failed`. A failed film carries
`error.message`. A key may have two films in flight at once.

## The rest

- `GET /v1` — what is here, and the limits as they stand. No key needed.
- `GET /v1/me` — the key, what it may ask for, and what it has spent.
- `GET /v1/files/{id}/{name}` — the file itself. No key needed.

## What it costs

Every answer carries `cost.inr` for that call, and the same spend appears in the
app's own records against the key that made it. A picture is about ₹9 at 2K; a
film is charged by the second at the model's rate — roughly ₹15 a second at
1080p, so a 16-second film is about ₹240. A key's daily limit, where one is set,
is checked before anything is spent.

## Errors

| Status | Means |
| --- | --- |
| `400` | Something in the request: no prompt, a reference that is not an image or a video, a bad data URI. |
| `401` | No key, or a key that has been switched off or deleted. |
| `403` | The key is not allowed that kind of request. |
| `404` | No such film, or no such file. |
| `429` | Too many films in flight for this key, or its daily limit is reached. |
| `502` | The model refused or could not be reached; a reference could not be fetched. |
| `503` | No key or model is configured in the app. |
