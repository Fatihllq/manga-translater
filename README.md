# Manga Translater

Translate manga pages into many languages directly in your browser. Edit the text and download translated pages as PNG or ZIP.

Current version: **0.6.7**. This repository contains the ready-to-load Chrome extension, including its local OCR and image processing models.

## Install in Chrome

1. Download this repository with **Code → Download ZIP**, or clone it with Git.
2. Extract the ZIP if necessary.
3. Open Chrome's extensions page and enable **Developer mode**.
4. Click **Load unpacked** and select the folder containing manifest.json.
5. Open a manga reader, choose your languages in the extension settings, and start translation.

Desktop Chrome 138 or newer with the built-in Translator API is required. Chrome may download translation language packs on first use. Available translation pairs depend on Chrome and the device.

## Features

- Local OCR for English, with French, Japanese, Korean and Chinese OCR in beta.
- Translation displayed on the manga page.
- Editable text, saved reading progress, and PNG/ZIP export.
- Local image and ZIP/CBZ import.

## Privacy and third-party software

OCR and translation run on the device. An external OCR or translation account, API key, subscription or separate server is not required.

See [PRIVACY.md](PRIVACY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Third-party license files are included with the bundled assets.

Some readers may prevent complete chapter discovery. Live-site compatibility varies by reader.

## Changes in 0.6.7

- Added French OCR in beta. Select French as the source language and Turkish as the target language to translate French manga into Turkish.
- Moved OCR and image processing for the reader overlay into an offscreen extension document.
