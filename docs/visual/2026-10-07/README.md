# Grip and stroke inspection · 2026-10-07

These are actual Blender 4.5.14 viewport captures through Blender MCP, with the canonical paddle attached at identity to the exported `GripR`. The source is `assets/sources/robot-player.blend`, rebuilt by `art/build-cyber-player.py`. `art/inspect-held-paddle.py` reproduces the inspection composition. Full temporary scenes and MCP receipts were stored on D:, separately from editable canonical assets.

- [Thumb side](grip-thumb.png): thumb rests along the lower black rubber; three fingers curl around the laminated handle.
- [Index side](grip-index.png): the supported index extends along the lower red rubber, distinct from the three gripping fingers. Mechanical joint styling is retained.
- [Left palm and actual 40 mm ball](serve-palm.png): ball sits above the open palm near the finger bases, clear of the wrist. This is the held pose, not evidence of a real toss. The final fine-satin ball material was captured here.
- Forehand [backswing at frame 9](forehand-backswing.png), [contact at 17](forehand-contact.png), and [follow-through at 25](forehand-follow-through.png): bent elbow and torso turn transfer to a forward/upward finish while feet stay planted.
- [Backhand contact at frame 17](backhand-contact.png): racket returns in front of the body with a folded elbow; the grip remains attached.

ServeHold and ServeToss body frames were also inspected in Blender. ServeHold keeps the left palm open; ServeToss raises it then withdraws. Actual release, independent ball flight and contact timing belong to the runtime/core checks. Near-camera arm cropping cannot be accepted from these outside views and is checked separately in the host browser.

Reference principles: Table Tennis England's [grip and ready-position guidance](https://newsarchive.tabletennisengland.co.uk/news/archived/coaching-grip-ready-position/) and [forehand stroke phases](https://newsarchive.tabletennisengland.co.uk/news/archived/developing-forehand-strokes/). These informed authored poses, not licensed model geometry; every model here remains project-authored.

Final robot SHA-256: `d7ae188323245ada9dceb6a8c9de229f318b91fedc2527b0dde0b47bd7461fba`. Final equipment SHA-256: `29e352bc1c4727675b510b67f6c419344cacf09addd2989530a850e99c5500cc`. The final equipment changed ball/table materials only; paddle geometry and grip/contact coordinates are unchanged from the inspected composition.
