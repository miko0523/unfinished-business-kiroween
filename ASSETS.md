# Assets

Where the pictures in this project come from.

## Old-house scenery (AI-generated)

The roof, the lobby, the five floor modules and the small hanging lantern are image files in `public/assets/dollhouse/`. They were generated with ChatGPT from a description we wrote. The hanging lantern was cut out of the lobby picture and lightly edited. `atlas.json` and `room-layout.json` describe the size and anchor points of these pictures.

## Everything else (drawn in code)

The ghost, the night sky, the moon, the trees and fireflies, the warm light of the lamps, the twelve keepsake stamps and the lantern ghost are drawn with SVG and CSS. No bitmap images are used for them.

## Screenshots

The pictures in `docs/screenshots/` are screenshots of this app with made-up tasks.

## Audio (AI-generated, chosen by the project founder)

Background music generated with Eleven Music; sound effects generated with ElevenLabs Sound Effects.

- The background music is a music-box piece, slowed to 0.8× speed and cut into a seamless loop of about 175.9 seconds.
- The seven short sound effects are for moving in, sweeping, watering, wiping, stamping, lighting a lamp and the lantern guest. They were loudness-normalised to roughly −20 to −23 LUFS.
- The project founder auditioned and chose every sound.
- Sound is optional and off by default. Nothing is decoded or played until the player turns the speaker switch on, and the switch is not remembered.
- The generated audio is embedded in a lazily loaded application module. The repository and build do not expose the outputs as standalone audio files or a reusable sound library.

Use of this generated media remains subject to the [ElevenCreative Terms](https://elevenlabs.io/creative-terms) and [Eleven Music Terms](https://elevenlabs.io/music-terms). It is not relicensed as stock audio.

## Fonts and icons

None are bundled. The interface uses system fonts, and all icons are drawn in code.

## Licence

The source code is under the MIT License (see `LICENSE`). The scenery images and embedded audio are generated media included as part of this project; they are not additionally licensed under MIT.
