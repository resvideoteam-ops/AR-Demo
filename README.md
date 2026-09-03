# AR Marker Demo — GitHub Pages

## Publish

1. Create a new GitHub repository.
2. Upload every file from this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select **main** and **/(root)**, then save.
6. Wait for GitHub to show the live site URL.

The final address normally follows:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

## Test

1. Open the GitHub Pages URL on your phone.
2. Tap **Start AR camera** and allow camera access.
3. Print `ar-target-print-a4.pdf`, or display the PNG on a second device.
4. Point the camera at the complete black marker.
5. Keep the marker visible while moving the phone around the cat, then tap the shutter button to save a photo.

Keep all filenames unchanged. The camera experience loads `ar-target.patt` using a relative path so it works from a GitHub project repository.
The optimised `lucky-lantern-cat-mobile.glb` model must remain beside `ar.html`.

A-Frame and AR.js are vendored as `vendor-aframe-1.6.0.js` and
`vendor-aframe-ar-3.4.7.js`, so the demo has no third-party runtime dependency and
cannot break because a CDN is slow or down. Both files must be uploaded alongside
`ar.html`.

## If the model flickers or drifts

Tracking quality is roughly half code, half physical setup.

- **Print on matte paper.** Glossy stock reflects room lights into the camera and
  wipes out the black border, which reads as a lost marker.
- **Print at 100% scale, no "fit to page".** The border-to-pattern ratio must stay
  at 0.5 or the pattern will not match.
- **Lay it flat.** A curled or tilted sheet bends the square and the pose solver
  fights it. Tape the corners down.
- **Even, indirect light.** Avoid a single hard lamp or direct sun; a bright hotspot
  across one half of the marker is the most common cause of drop-outs.
- **Keep the whole black square in frame,** including the border. Cropping any edge
  loses the marker instantly.
- **Stay within about 20–70 cm.** Further out and the inner pattern is too few pixels
  to identify; closer and the border leaves the frame.

## Backend and hosting

The site now ships a Cloudflare backend: admin model uploads, R2 storage and
privacy-preserving usage analytics. See `DEPLOY.md` for the deployment steps.

GitHub Pages can still serve the AR experience on its own — the page falls back
to the bundled model when the API is absent — but uploads and analytics require
Cloudflare.

To shrink a Meshy export before uploading:

```bash
python3 tools/optimize-glb.py meshy-export.glb ready-for-ar.glb --max-mb 3
```
