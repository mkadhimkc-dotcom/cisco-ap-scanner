# Label Scanner

Phone web app that reads the barcodes on Cisco switch and Cisco/Meraki access point labels and exports them as CSV.
Everything runs in the browser. Camera frames and photos are never uploaded or stored.

## Put it on GitHub Pages

1. Create a new GitHub repository (for example `label-scanner`).
2. Upload everything in this folder to the root of the repo: `index.html`, `app.js`, `core.js`, `.nojekyll`, `README.md` and the `vendor/` folder.
3. In the repo, open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. After a minute the site is live at `https://<your-username>.github.io/label-scanner/`.
5. Open that address in Safari on the iPhone. Tap **Share > Add to Home Screen** to get an app icon.

The camera only works over `https://`, which GitHub Pages provides. Opening `index.html` straight from Files will not work.

## Using it

- **Home**: lists your scan files. Each file is its own data set: devices are numbered from #1 and duplicates are only checked inside that file. Tap the trash icon (then **Delete**) to remove a file, or use **Settings > Delete all files**.
- **New file**: Tap **+** to start a new one, give it a name and an optional site, and choose what you are scanning: **Access points**, **Switches**, or **Different devices** (type detected per device).
- **Live scan**: point at one device's labels. Fields tick off as they are read. Nothing is saved until you tap **Save device**. The camera stays open for the next device.
- **Take photo**: one 12 MP shot. Reads small or blurry barcodes better than live scan, because live frames are about 2 MP.
- **Scan more / Add photo** on a device card adds another scan to that same device, to fill in what was missed. Each card shows **Complete** or how many fields are missing.
- **Duplicates**: a device whose asset tag, MAC, serial or Meraki serial matches another device in the same file is outlined in red, with the matching field and device named. Live scan warns before you save a device that is already scanned. Exports shade duplicate rows red in Excel and add a **Duplicate Of** column.
- **Export**: pick **Excel (.xlsx)** or **CSV**, the columns (**All fields**, **Asset, MAC, S/N**, or **Custom**), the MAC format and the file name. A table preview and a missing-info summary show before you send. Then **Email or share** (iPhone share sheet with the file attached; choose Mail or Save to Files), **Download**, or **Copy as table** (pastes into Excel, Numbers or Sheets).

Files stay on the phone (browser storage) until you delete them.

## What it reads

| Label | Fields |
|---|---|
| Cisco switch (e.g. C9300) | Asset tag, MAC, serial, PID, part number, CLEI (from the Data Matrix) |
| Meraki/Cisco AP (e.g. CW9166I) | Asset tag, MAC, Cisco S/N, Meraki serial, PID |

The asset tag pattern defaults to 4 to 9 digits and can be changed under **Settings**.

## Files

- `index.html`: layout and styles
- `app.js`: scan files, camera, photo handling, device list, export
- `xlsx.js`: small Excel (.xlsx) writer, no dependencies
- `core.js`: image processing (barcode region finder, deskew), label field classification, CSV
- `vendor/`: [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 2.2.4 barcode decoder (MIT, see license file)
