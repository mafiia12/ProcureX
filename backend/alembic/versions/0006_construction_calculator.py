"""Add the construction consumption and productivity calculator.

Revision ID: 0006_construction_calculator
Revises: 0005_purchase_request_document_capture
"""

from alembic import op

from construction_calculator import models


revision = "0006_construction_calculator"
down_revision = "0005_purchase_request_document_capture"
branch_labels = None
depends_on = None


TABLES = [
    models.ConstructionImportRun.__table__,
    models.ConstructionImportIssue.__table__,
    models.ConstructionCategory.__table__,
    models.ConstructionWorkItem.__table__,
    models.ConstructionMaterial.__table__,
    models.ConstructionLaborRole.__table__,
    models.ConstructionEquipment.__table__,
    models.ConstructionWorkCrew.__table__,
    models.ConstructionCrewLaborMember.__table__,
    models.ConstructionCrewEquipment.__table__,
    models.ConstructionMaterialRate.__table__,
    models.ConstructionProductivityRate.__table__,
    models.ConstructionWorkItemAdjustment.__table__,
    models.ConstructionMarketAlias.__table__,
    models.ConstructionCalculationSession.__table__,
    models.ConstructionCalculationMaterialResult.__table__,
    models.ConstructionCalculationLaborResult.__table__,
    models.ConstructionCalculationEquipmentResult.__table__,
    models.ConstructionCalculationSnapshot.__table__,
    models.ConstructionPurchaseRequestLink.__table__,
    models.ConstructionPurchaseRequestItemLink.__table__,
]


def upgrade() -> None:
    bind = op.get_bind()
    for table in TABLES:
        table.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for table in reversed(TABLES):
        table.drop(bind=bind, checkfirst=True)
