# The hero video

The homepage hero plays a **real background video — no slideshow**:

| File | What it is |
|---|---|
| `public/hero/hero.mp4` | **3840×2160 (true 4K)**, 30fps, 16s seamless push-in/pull-out loop, ~9.7MB |
| `public/hero/hero-1080.mp4` | 1080p variant, ~2.2MB — served automatically on screens < 1280px |
| `public/hero/hero-poster-4k.jpg` | 4K poster: first paint + fallback |
| `public/hero/hero-4k.png` | the 4K master frame (AI-generated showroom render, upscaled to 4096×2294) |

`components/HeroVideo.tsx` picks the right file per screen, plays it muted + looped, and
falls back to the poster with a Ken-Burns push for reduced-motion / save-data visitors or
any decode failure. The company name, location and product count are crisp HTML overlay —
never baked into the video — so they stay sharp at any resolution and stay editable.

## How this video was made (and how to replace it)

AI *video* generation needs more credits than the account's free tier holds (cheapest
model: 6 credits; balance at the time: 4), so the ship-today film was rendered locally
with ffmpeg from an AI-generated + 4K-upscaled master frame:

```bash
# palindrome loop: 8s push-in + 8s pull-out = seamless 16s
ffmpeg -i public/hero/hero-4k.png -filter_complex "\
[0:v]crop=4078:2294:9:0,scale=7680:4320:flags=lanczos,split[a][b];\
[a]zoompan=z='1+0.10*on/239':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=240:s=3840x2160:fps=30[va];\
[b]zoompan=z='1.10-0.10*on/239':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=240:s=3840x2160:fps=30[vb];\
[va][vb]concat=n=2:v=1:a=0,format=yuv420p[v]" \
-map "[v]" -c:v libx264 -crf 21 -preset medium -movflags +faststart public/hero/hero.mp4
```

To swap in a full AI brand film (multi-shot 3D product sequences), top up the media plan,
generate with a video model, and either overwrite `public/hero/hero.mp4` (+ re-render the
1080p variant) or point `NEXT_PUBLIC_HERO_VIDEO` at the new file. Keep it: **muted,
10–20s loop, dark/blue graded, action on the RIGHT** — the left third is where the
headline sits.

## The "design movement" (scroll reel)

`components/ShowroomReel.tsx` renders the two-row opposite-direction product reel from the
reference site, using the shop's **own** catalogue photography (not stock images). It sits
directly under the hero.
