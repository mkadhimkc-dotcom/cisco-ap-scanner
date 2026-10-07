# Device test checklist (real iPhone)

Everything here has been tested only in desktop Chromium with a fake camera. Run these checks on a real iPhone in Safari, with real labels, before relying on the app in the field.

For each item, record the iPhone model, iOS version, pass/fail, and a note.

| # | Check | How | Pass when |
|---|---|---|---|
| 1 | Install | Open the Pages URL in Safari, then **Share > Add to Home Screen**. Open the app from the icon. | Opens full screen with the Label Scanner icon and name. The footer shows `Label Scanner 2.0.0`. |
| 2 | Camera permission, home-screen app | Start **Live scan** from the home-screen app. Close the app and reopen it, then start Live scan again. | The prompt appears once, the preview shows the back camera, and the second start works without a black preview. |
| 3 | AP label, live | New file *Access points*. Live scan a real CW91xx label in normal room light, holding the phone 15–25 cm away. | MAC, serial, Meraki serial and PID all turn green within about 5 s. Values match the label. |
| 4 | Switch label, live | New file *Switches*. Live scan a real C9300/C9200 rear label. | MAC, serial, PID, part number and CLEI (Data Matrix) read. Values match the label. |
| 5 | Rack lighting and gloves | In a dim closet with the torch on, wearing work gloves, scan a device mounted in a rack. | The torch toggles. All buttons can be hit with gloves. Fields still read. |
| 6 | Tiny codes, full-res still | Tap **Full-res still**, then try **Take photo**, on a label whose PID or Meraki code did not read live. | The missing field fills from the still or photo. |
| 7 | Zoom and tap to focus | During live scan, move the zoom slider and tap the preview on a barcode. | The image zooms, or the hint says zoom is not available. Tapping refocuses, or does nothing harmful. |
| 8 | Background and resume | During live scan, go to the home screen for 10 s, then come back. Lock and unlock the phone. | The camera light goes off when the app is hidden. Live scan can be restarted, with no frozen preview. |
| 9 | Save, auto-save, repeat | Save a device. Turn on **Auto-save**, then scan two more. Rescan the first one. | Boxes clear after each save. Numbering continues #1, #2, #3. The rescan asks **Open existing / Add as new**. |
| 10 | Asset tag on another face | Tap **Scan asset tag** on a card and point at the asset sticker. | The asset tag fills, and the app returns to the file. |
| 11 | Data survives | Add 3 devices, swipe the app away, and reopen it. Reboot the phone and reopen. | All files and devices are still there. |
| 12 | Offline | Open the app once online. Turn on Airplane Mode, then reopen it and take a photo of a label. | The app opens, decodes the photo, and saves the device. |
| 13 | Export and share | **Finish and export** in CSV, then Excel, then JSON. Use **Email or share** and pick Mail, then Save to Files. | The file is attached with the name `label-scan_<file>_<date>.<ext>`. CSV opens in Excel or Numbers with the expected columns. Excel shows duplicate rows shaded. |
| 14 | Original CSV templates | Export *All fields* and *Asset tag, MAC, serial*. Open them in the tool that consumes them today. | The headers and column order are exactly as before, and the import works. |
| 15 | Readability and VoiceOver | Use the app in light and dark mode at the largest text size. With VoiceOver on, run a live scan. | Text is readable, with no horizontal scrolling. VoiceOver announces each field as it is read. |

Report anything that fails with a screenshot. Note the label model too, and include a photo of the label if it is allowed to leave the site.
