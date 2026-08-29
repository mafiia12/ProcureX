"""WhatsApp intake: a third input channel for the existing Incoming Purchase
Request workflow (alongside the anonymous public intake and the Site
Portal). Confirmed requests are created via site_portal.create_incoming_request
- this module never runs its own parallel request/approval workflow.

Deliberately no re-exports here (unlike document_capture/__init__.py):
auth/admin_router.py only needs the lightweight phone.py helper, and
should not have to pull in the full router/session_service/site_portal
import chain just to normalize a phone number. Import submodules directly,
e.g. `from .whatsapp.router import router`.
"""
