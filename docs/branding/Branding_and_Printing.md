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

Printed passes are **landscape ID-card size: 85.6 × 54 mm**. Actual size / 100% printing is required. Keep every QR's quiet zone and high contrast. Pending and approved cards share an identity-only layout and QR. Print employee assigned-project summaries as affiliation; visitor cards show host identity and purpose. Do not print approval labels or access explanations. Live guard verification enforces project access. Card size, small references and QR readability require a physical reception-printer/guard-device pilot. See [the implementation contract](../database/14_Visitor_Identity_and_Multi_Project_Guards.md).


The approved layout and trusted field mapping are implemented in [document 15](../database/15_Trusted_Card_Details_and_Layout.md); previews use the same internal renderer.


Subsequent cancellation/occupancy is implemented in [document 16](../database/16_Individual_Cancellation_and_Occupancy.md). Physical printer testing is deferred to final acceptance and does not block other development.
