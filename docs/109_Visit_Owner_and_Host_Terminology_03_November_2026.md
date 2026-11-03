# Visit owner and Host — 3 November 2026

- **Visit owner:** the authenticated person who creates an invitation and coordinates it. The existing creator owns its draft/revisions and receives the configured planning updates. Creation does not give authority to approve their own request.
- **Host:** an authorized internal person who reviews access for a destination account/project. Each destination retains its own configured review and permissions. A destination host remains labelled Host after their recorded decision.
- **Other participants:** office/security reviewers, facilities coordinators, administrators and notification-only recipients keep their existing responsibilities. Notification alone does not make someone a Host or Visit owner.

An approved host may create an invitation; on that invitation they are the Visit owner. Account/project host rosters and their management permissions remain unchanged.

## UI and mail

Coordination lists, visit details, the creator's role, invitation form/review and planning emails identify the creator as **Visit owner**. Destination review panels and their assigned names identify the **Host** approval. Regular visitor registration, reception/guard pass host labels and their emails continue to mean the actual selected Host.

The optional preparation field previously labelled “Visit owner (notify)” is now **Additional contact (notify)**. It retains its existing FYI behavior and cannot assign or transfer ownership.

## Compatibility

This changes presentation terminology, not authorization or stored identities. Existing SQL `HostUserId`, domain `hostId` and planning API/mail `hostName` fields still refer to the invitation creator. The optional preparation `visitOwnerId` remains the legacy wire key for the additional FYI contact. These meanings are annotated in source; no applied migration is rewritten.

Historical implementation notes may use Host for the invitation creator; this glossary supersedes that terminology for the current coordination UI.
