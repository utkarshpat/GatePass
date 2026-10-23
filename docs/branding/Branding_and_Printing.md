# Branding and print requirements

Confirmed by the user on 20 October 2026.

Sopra Steria is the organisation brand and must be prominent across the application and printed cards. GatePass is the application brand: retain it small and subtle at the bottom. Both brands appear together. This requirement applies to login/landing, employee/visitor intake and status, guard, reception, administrative screens, digital cards and print output. The shared UI shell is not implemented yet; the current implementation is the card renderer and development previews.

Card layout refinement: the company logo is compact at top-left (320 viewBox units wide), with the pass title at top-right. GatePass is small at bottom-right. Validity is stacked and the photo is contained without stretching. Original logo proportions and the 85.6 x 54 mm landscape size are preserved.

| Supplied asset | Use |
|---|---|
| assets/brand/sopra-steria-logo.png | Prominent horizontal header on landscape cards and wide screens |
| assets/brand/sopra-steria-stacked.png | Alternative for appropriately sized compact/tall placements |
| assets/brand/sopra-steria-icon.png | Compact brand mark, including the small QR centre on both pending and approved cards |
| assets/brand/gatepass-logo.png | Small application signature at the bottom |

Preserve source proportions and colours; do not stretch, crop or recreate supplied logos. Use a white surface behind the dark wordmark. The simple light UI uses crimson primary actions, restrained orange accents, readable dark text and clear textual statuses. Colour alone must never communicate approval or access.

## Optimized runtime logo assets

On 23 October 2026, the three runtime PNG logos were resized for their current placements and compressed as indexed PNGs using Sharp with quality 100, compression level 9, effort 10 and dithering disabled. Aspect ratios and existing transparency are retained. These are resized delivery assets; the original images remain recoverable from Git history. The unused stacked alternative is unchanged.

| Runtime asset | Original dimensions | Runtime dimensions | Original bytes | Runtime bytes |
|---|---|---|---:|---:|
| gatepass-logo.png | 1254 × 1254 | 192 × 192 | 1,089,201 | 14,993 |
| sopra-steria-logo.png | 1024 × 137 | 768 × 103 | 34,390 | 18,693 |
| sopra-steria-icon.png | 1524 × 1129 | 192 × 142 | 101,536 | 6,683 |

Combined runtime brand payload falls from 1,225,127 to 40,369 bytes, a 96.7% reduction. The horizontal wordmark retains enough width for the 640-pixel rendered card header. The application mark and organisation icon cover the current footer and QR badge sizes. Enlarged future placements should use the original artwork or a separately generated larger delivery asset.

Validation uses the existing printing suite, including exact-payload decoding for 24 synthetic credentials at 600, 1000 and 1600 pixel card widths, and full-card decoding at 1000 pixels. The local server preloads logos at startup, so a running instance must reload them before displaying the optimized assets. Physical printer acceptance remains separate.

Printed passes are **landscape ID-card size: 85.6 × 54 mm**. Actual size / 100% printing is required. Keep every QR's quiet zone and high contrast. Pending and approved cards share an identity-only layout and QR. Print employee assigned-project summaries as affiliation; visitor cards show host identity and purpose. Do not print approval labels or access explanations. Live guard verification enforces project access. Card size, small references and QR readability require a physical reception-printer/guard-device pilot. See [the implementation contract](../database/14_Visitor_Identity_and_Multi_Project_Guards.md).


The approved layout and trusted field mapping are implemented in [document 15](../database/15_Trusted_Card_Details_and_Layout.md); previews use the same internal renderer.


Subsequent cancellation/occupancy is implemented in [document 16](../database/16_Individual_Cancellation_and_Occupancy.md). Physical printer testing is deferred to final acceptance and does not block other development.
