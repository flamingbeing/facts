# Device test (live app, two devices)

Run per starter release against the deployed app (not part of `npx playwright test`). See the header of `device.mjs`.

    DEVICE_URL=https://<app> DEVICE_EMAIL=... DEVICE_PASSWORD=... node tests/device/device.mjs
    ANDROID=1 ...                  # device A = real Chrome on a started Android emulator (adb); stop it afterwards
    --phase=install, then deploy, then --phase=update      # check 4 (update after a new deploy)

    --phase=extra                  # checks 5-6, after the four on a good deploy: same item edited offline on both devices;
                                   # 12 offline saves + force-quit + flapping network

The test user must already be a member of that app. iPhone Safari stays a manual check.
