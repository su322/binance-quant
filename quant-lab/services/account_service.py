from sqlalchemy.orm import Session
from quant_lab.database.models import Account, Order, Trade, Position


class AccountService:
    def __init__(self, db: Session):
        self._db = db

    def list_accounts(self) -> list[Account]:
        return self._db.query(Account).all()

    def get_account(self, account_id: int) -> Account | None:
        return self._db.get(Account, account_id)

    def get_active_account(self) -> Account | None:
        return self._db.query(Account).filter(Account.is_active.is_(True)).first()

    def create_account(self, name: str, balance: float = 10000.0) -> Account:
        has_any = self._db.query(Account).first() is not None
        acc = Account(name=name, balance=balance, initial_balance=balance, is_active=not has_any)
        self._db.add(acc)
        self._db.commit()
        return acc

    def activate_account(self, account_id: int) -> Account | None:
        acc = self._db.get(Account, account_id)
        if not acc:
            return None
        # Deactivate all others
        self._db.query(Account).update({"is_active": False})
        acc.is_active = True
        self._db.commit()
        return acc

    def delete_account(self, account_id: int):
        acc = self._db.get(Account, account_id)
        if acc:
            self._db.delete(acc)
            self._db.commit()
            # If deleted was active, activate another
            remaining = self._db.query(Account).first()
            if remaining:
                remaining.is_active = True
                self._db.commit()

    def get_orders(self, account_id: int) -> list[Order]:
        return self._db.query(Order).filter_by(account_id=account_id).all()

    def get_trades(self, account_id: int) -> list[Trade]:
        return self._db.query(Trade).filter_by(account_id=account_id).all()

    def get_positions(self, account_id: int) -> list[Position]:
        return self._db.query(Position).filter_by(account_id=account_id).all()
