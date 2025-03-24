"""Add time range columns to Project model

Revision ID: add_time_range_columns
Revises: 
Create Date: 2025-03-24 10:00:00

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_time_range_columns'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('project', sa.Column('trim_start', sa.DateTime(), nullable=True))
    op.add_column('project', sa.Column('trim_end', sa.DateTime(), nullable=True))
    op.add_column('project', sa.Column('total_duration', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('project', 'trim_start')
    op.drop_column('project', 'trim_end')
    op.drop_column('project', 'total_duration')