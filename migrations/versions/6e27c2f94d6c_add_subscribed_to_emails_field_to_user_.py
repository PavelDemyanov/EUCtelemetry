"""Add subscribed_to_emails field to User model

Revision ID: 6e27c2f94d6c
Revises: 82b80592e546
Create Date: 2025-02-19 11:43:11.097112

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6e27c2f94d6c'
down_revision = '82b80592e546'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('subscribed_to_emails', sa.Boolean(), nullable=True))

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('subscribed_to_emails')

    # ### end Alembic commands ###
