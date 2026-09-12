# Review and account improvements

- The first item's pickup area fills empty areas in other private items from the same photo. Existing choices are preserved. Each item can be changed independently, and the values survive reloads.
- Photo review zooms to the active detection box. The complete photo and all boxes remain available in an expandable view. New detected items receive actual cropped image files; manual or unlocalized items use the full photo. Cards and detail pages preserve the complete approved image.
- Existing listings keep their previously reviewed images. To use their saved detection box, open the listing editor, expand **Adjust photo crop**, choose **Use detected item crop**, and review/save the change.
- **Account settings → Delete account** provides password-confirmed deletion. The cleanup and recovery procedure is documented in [account-deletion.md](account-deletion.md).
- The header and app icon use the artwork supplied by the user. The original PNG is retained, with white areas composited against the app's paper color.

Validation for this change: production build, TypeScript, ESLint, 72 unit checks, 42 hosted backend checks, and the live photo-review and disposable-account deletion regressions. Browser evidence is under `output/qa/review-improvements` and `output/qa/scan-review-*`, plus `output/qa/account-deletion-confirmation.png`. The provider regression uses one licensed sample photo and does not claim a detection accuracy evaluation.
