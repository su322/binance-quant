"""Simulated order execution engine."""
from datetime import datetime
from decimal import Decimal
from sqlalchemy.orm import Session
from quant_lab.database.models import Account, Order, Position, Trade, OrderStatus

TAKER_FEE_RATE = 0.0005  # 0.05% taker (market order) fee for perpetual
MAKER_FEE_RATE = 0.0002  # 0.02% maker (limit order) fee for perpetual
SPOT_FEE_RATE = 0.0

_DURATION_SECONDS = {"10m": 600, "30m": 1800, "1h": 3600, "1d": 86400}
_PAYOUT_RATES = {"10m": 0.8, "30m": 0.85, "1h": 0.85, "1d": 0.85}


class SimulatedExecutor:
    """Matches orders against current kline price for simulation."""

    def __init__(self, db: Session):
        self._db = db

    def create_account(self, name: str, initial_balance: float = 10000.0) -> Account:
        account = Account(name=name, balance=initial_balance)
        self._db.add(account)
        self._db.commit()
        return account

    def place_order(
        self, account_id: int, symbol: str, side: str,
        quantity: float, price: float | None = None,
        order_type: str = "market", duration: str | None = None,
        take_profit: float | None = None, stop_loss: float | None = None,
        mode: str = "spot", leverage: float = 1,
    ) -> Order:
        account = self._db.get(Account, account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        if price is None:
            raise ValueError("Simulated orders require a price")

        fee_rate = TAKER_FEE_RATE if mode == "perpetual" else SPOT_FEE_RATE

        # Event contract order
        if order_type == "event":
            if account.balance < quantity:
                raise ValueError(f"Insufficient balance: {account.balance} < {quantity}")
            order = Order(
                account_id=account_id, symbol=symbol,
                side=side, price=price, quantity=quantity,
                type=order_type, duration=duration, mode=mode,
            )
            account.balance -= quantity  # deduct investment immediately
            self._db.add(order)
            self._db.commit()
            return order

        order = Order(
            account_id=account_id, symbol=symbol,
            side=side, price=price, quantity=quantity, mode=mode,
            type=order_type,
        )

        if order_type == "limit":
            self._db.add(order)
            self._db.commit()
            return order

        # Market order: fill immediately
        cost = quantity * price

        if mode == "perpetual":
            margin = cost / leverage
            if account.balance < margin:
                raise ValueError(f"Insufficient margin: {account.balance:.2f} < {margin:.2f}")
        else:
            if account.balance < cost:
                raise ValueError(f"Insufficient balance: {account.balance:.2f} < {cost:.2f}")

        order.status = OrderStatus.FILLED
        order.filled_qty = quantity
        order.filled_price = price
        self._db.add(order)
        self._db.flush()

        fee = cost * fee_rate

        position = self._db.query(Position).filter_by(
            account_id=account_id, symbol=symbol, mode=mode,
        ).first()
        if not position:
            position = Position(account_id=account_id, symbol=symbol, mode=mode, side='long', quantity=0.0, avg_entry_price=0.0)
            self._db.add(position)

        if mode == "perpetual":
            # Perpetual position management with margin accounting
            if side == "buy":
                if position.quantity > 0 and position.side == "long":
                    # Increase long position
                    total_qty = position.quantity + quantity
                    total_cost = position.avg_entry_price * position.quantity + cost
                    position.quantity = total_qty
                    position.avg_entry_price = total_cost / total_qty if total_qty > 0 else 0
                    position.used_margin = (position.used_margin or 0) + margin
                    account.balance -= margin + fee
                elif position.quantity > 0 and position.side == "short":
                    # Reduce/close short position
                    close_qty = min(quantity, position.quantity)
                    close_margin = (position.used_margin or 0) * (close_qty / position.quantity) if position.quantity > 0 else 0
                    if close_margin == 0 and position.avg_entry_price:
                        close_margin = close_qty * position.avg_entry_price
                    pnl = (position.avg_entry_price - price) * close_qty - fee
                    position.realized_pnl = (position.realized_pnl or 0) + pnl
                    position.quantity -= close_qty
                    position.used_margin = (position.used_margin or 0) - close_margin
                    remaining = quantity - close_qty
                    if remaining > 0:
                        # Flip to long
                        position.side = "long"
                        position.quantity = remaining
                        position.avg_entry_price = price
                        new_margin = remaining * price / leverage
                        position.used_margin = new_margin
                        account.balance += close_margin + pnl - new_margin
                    else:
                        account.balance += close_margin + pnl
                else:
                    # No position, open long
                    position.side = "long"
                    position.quantity = quantity
                    position.avg_entry_price = price
                    position.used_margin = margin
                    account.balance -= margin + fee
            else:  # side == "sell"
                if position.quantity > 0 and position.side == "short":
                    # Increase short position
                    total_qty = position.quantity + quantity
                    total_cost = position.avg_entry_price * position.quantity + cost
                    position.quantity = total_qty
                    position.avg_entry_price = total_cost / total_qty if total_qty > 0 else 0
                    position.used_margin = (position.used_margin or 0) + margin
                    account.balance -= margin + fee
                elif position.quantity > 0 and position.side == "long":
                    # Reduce/close long position
                    close_qty = min(quantity, position.quantity)
                    close_margin = (position.used_margin or 0) * (close_qty / position.quantity) if position.quantity > 0 else 0
                    if close_margin == 0 and position.avg_entry_price:
                        close_margin = close_qty * position.avg_entry_price
                    pnl = (price - position.avg_entry_price) * close_qty - fee
                    position.realized_pnl = (position.realized_pnl or 0) + pnl
                    position.quantity -= close_qty
                    position.used_margin = (position.used_margin or 0) - close_margin
                    remaining = quantity - close_qty
                    if remaining > 0:
                        # Flip to short
                        position.side = "short"
                        position.quantity = remaining
                        position.avg_entry_price = price
                        new_margin = remaining * price / leverage
                        position.used_margin = new_margin
                        account.balance += close_margin + pnl - new_margin
                    else:
                        account.balance += close_margin + pnl
                else:
                    # No position, open short
                    position.side = "short"
                    position.quantity = quantity
                    position.avg_entry_price = price
                    position.used_margin = margin
                    account.balance -= margin + fee
        elif mode != "spot":
            # Legacy perpetual (no long/short management, fallback)
            if side == "buy":
                total_qty = position.quantity + quantity
                total_cost = position.avg_entry_price * position.quantity + cost
                position.quantity = total_qty
                position.avg_entry_price = total_cost / total_qty if total_qty > 0 else 0
            else:
                position.quantity -= quantity
                if position.quantity < 0:
                    position.quantity = 0
            if side == "buy":
                account.balance -= cost + fee
            else:
                account.balance += cost - fee
        else:
            # Spot: buy increase, sell decrease
            if side == "buy":
                total_qty = position.quantity + quantity
                total_cost = position.avg_entry_price * position.quantity + cost
                position.quantity = total_qty
                position.avg_entry_price = total_cost / total_qty if total_qty > 0 else 0
            else:
                position.quantity -= quantity
                if position.quantity < 0:
                    position.quantity = 0
            if side == "buy":
                account.balance -= cost + fee
            else:
                account.balance += cost - fee

        if take_profit is not None:
            position.take_profit = take_profit
        if stop_loss is not None:
            position.stop_loss = stop_loss

        trade = Trade(
            order_id=order.id, account_id=account_id,
            symbol=symbol, side=side,
            fill_price=price, fill_qty=quantity,
            fee=fee,
        )
        self._db.add(trade)
        self._db.commit()
        return order

    def close_position(self, account_id: int, symbol: str, quantity: float, price: float, mode: str) -> Order:
        """Close a position (partially or fully). Returns the closing order."""
        account = self._db.get(Account, account_id)
        if not account:
            raise ValueError(f"Account {account_id} not found")

        position = self._db.query(Position).filter_by(
            account_id=account_id, symbol=symbol, mode=mode,
        ).first()
        if not position or position.quantity <= 0:
            raise ValueError("No position to close")

        qty = min(quantity, position.quantity)
        fee_rate = TAKER_FEE_RATE if mode == "perpetual" else SPOT_FEE_RATE
        fee = qty * price * fee_rate
        if position.side == "short":
            realized_pnl = (position.avg_entry_price - price) * qty - fee
        else:
            realized_pnl = (price - position.avg_entry_price) * qty - fee

        close_side = "buy" if position.side == "short" else "sell"
        order = Order(
            account_id=account_id, symbol=symbol,
            side=close_side, price=price, quantity=qty,
            type="market",
        )
        order.status = OrderStatus.FILLED
        order.filled_qty = qty
        order.filled_price = price
        self._db.add(order)
        self._db.flush()

        if mode == "perpetual":
            orig_margin = position.used_margin or 0
            if orig_margin > 0:
                released_margin = orig_margin * (qty / position.quantity) if position.quantity > 0 else 0
            else:
                # Legacy position opened before margin accounting: full cost was deducted
                released_margin = qty * position.avg_entry_price
            account.balance += released_margin + realized_pnl
            position.used_margin = max(0, orig_margin - released_margin)
        elif position.side == "short":
            account.balance -= qty * price + fee
        else:
            account.balance += qty * price - fee
        position.realized_pnl = (position.realized_pnl or 0) + realized_pnl

        # Partial close: keep avg_entry, reduce qty
        # Full close: qty stays at 0, preserving record for history
        if qty >= position.quantity:
            position.quantity = 0
            position.take_profit = None
            position.stop_loss = None
        else:
            position.quantity -= qty

        trade = Trade(
            order_id=order.id, account_id=account_id,
            symbol=symbol, side=close_side,
            fill_price=price, fill_qty=qty,
            fee=fee, realized_pnl=realized_pnl,
        )
        self._db.add(trade)
        self._db.commit()
        return order

    def settle_event_orders(self, account_id: int, current_prices: dict[str, float]) -> list[Order]:
        """Settle any overdue event orders for the given account."""
        now = datetime.utcnow()
        pending = self._db.query(Order).filter(
            Order.account_id == account_id,
            Order.status == OrderStatus.PENDING,
            Order.type == "event",
        ).all()

        settled = []
        for order in pending:
            dur_sec = _DURATION_SECONDS.get(order.duration, 600)
            # Check if order is due for settlement
            if not order.created_at:
                continue
            elapsed = (now - order.created_at).total_seconds()
            if elapsed < dur_sec:
                continue

            account = self._db.get(Account, order.account_id)
            if not account:
                continue

            current_price = current_prices.get(order.symbol)
            if current_price is None:
                continue  # can't settle without price

            entry_price = order.price or current_price
            direction = order.side  # 'buy' = up, 'sell' = down
            amount = order.quantity
            payout_rate = _PAYOUT_RATES.get(order.duration, 0.85)

            # Determine win/loss
            if (direction == "buy" and current_price > entry_price) or \
               (direction == "sell" and current_price < entry_price):
                # Win
                profit = amount * payout_rate
                order.status = OrderStatus.FILLED
                order.filled_qty = amount
                order.filled_price = current_price
                account.balance += amount + profit
                realized_pnl = profit
            else:
                # Loss
                order.status = OrderStatus.CANCELED
                order.filled_qty = 0
                order.filled_price = current_price
                realized_pnl = -amount

            trade = Trade(
                order_id=order.id, account_id=order.account_id,
                symbol=order.symbol, side=order.side,
                fill_price=current_price, fill_qty=amount,
                fee=0.0, realized_pnl=realized_pnl,
            )
            self._db.add(trade)
            self._db.add(order)
            settled.append(order)

        if settled:
            self._db.commit()

        return settled

    def fill_pending_orders(self, symbol: str, current_price: float) -> list[Order]:
        """Fill any pending limit orders for symbol where the price condition is met."""
        pending = self._db.query(Order).filter(
            Order.symbol == symbol,
            Order.status == OrderStatus.PENDING,
            Order.type == "limit",
        ).all()

        filled_orders = []
        for order in pending:
            account = self._db.get(Account, order.account_id)
            if not account:
                continue

            price = order.price
            qty = order.quantity

            if order.side == "buy" and current_price > price:
                continue
            if order.side == "sell" and current_price < price:
                continue

            cost = qty * price
            if order.side == "buy" and account.balance < cost:
                continue

            order.status = OrderStatus.FILLED
            order.filled_qty = qty
            order.filled_price = price

            fee = cost * MAKER_FEE_RATE
            if order.side == "buy":
                account.balance -= cost + fee
            else:
                account.balance += cost - fee

            pmode = getattr(order, 'mode', 'spot') or 'spot'
            position = self._db.query(Position).filter_by(
                account_id=order.account_id, symbol=symbol, mode=pmode,
            ).first()
            if not position:
                position = Position(account_id=order.account_id, symbol=symbol, mode=pmode, quantity=0.0, avg_entry_price=0.0)
                self._db.add(position)

            if order.side == "buy":
                total_qty = position.quantity + qty
                total_cost = position.avg_entry_price * position.quantity + cost
                position.quantity = total_qty
                position.avg_entry_price = total_cost / total_qty if total_qty > 0 else 0
            else:
                position.quantity -= qty
                if position.quantity < 0:
                    position.quantity = 0

            trade = Trade(
                order_id=order.id, account_id=order.account_id,
                symbol=symbol, side=order.side,
                fill_price=price, fill_qty=qty,
                fee=fee,
            )
            self._db.add(trade)
            self._db.add(order)
            filled_orders.append(order)

        if filled_orders:
            self._db.commit()

        return filled_orders

    def update_tp_sl(self, account_id: int, symbol: str, mode: str,
                      take_profit: float | None = None, stop_loss: float | None = None) -> Position:
        """Update take profit / stop loss for an open position."""
        position = self._db.query(Position).filter_by(
            account_id=account_id, symbol=symbol, mode=mode,
        ).first()
        if not position or position.quantity <= 0:
            raise ValueError("No open position found")
        if take_profit is not None:
            position.take_profit = take_profit
        if stop_loss is not None:
            position.stop_loss = stop_loss
        self._db.commit()
        return position

    def cancel_order(self, order_id: int) -> Order:
        """Cancel a pending order (limit or event)."""
        order = self._db.get(Order, order_id)
        if not order:
            raise ValueError(f"Order {order_id} not found")
        if order.status != OrderStatus.PENDING:
            raise ValueError(f"Order {order_id} is not pending")

        order.status = OrderStatus.CANCELED

        # Refund balance for event orders
        if order.type == "event":
            account = self._db.get(Account, order.account_id)
            if account:
                account.balance += order.quantity  # refund the staked amount

        self._db.commit()
        return order

    def check_tp_sl(self, symbol: str, current_price: float) -> list[Order]:
        """Auto-close positions where TP or SL is triggered."""
        positions = self._db.query(Position).filter(
            Position.symbol == symbol,
            Position.quantity > 0,
            Position.mode == "perpetual",
        ).all()

        closed = []
        for pos in positions:
            triggered = False
            if pos.take_profit is not None and current_price >= pos.take_profit:
                triggered = True
            if not triggered and pos.stop_loss is not None and current_price <= pos.stop_loss:
                triggered = True
            if not triggered:
                continue

            order = self.close_position(
                account_id=pos.account_id, symbol=pos.symbol,
                quantity=pos.quantity, price=current_price, mode="perpetual",
            )
            closed.append(order)

        return closed
