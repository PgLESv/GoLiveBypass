#!/usr/bin/env python3
"""Control the native Linux screen-share portal used by the live RTC lab."""

from __future__ import annotations

import argparse
import json
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402


def children(node):
    for index in range(node.get_child_count()):
        yield node.get_child_at_index(index)


def find(node, *, role: str | None = None, name: str | None = None):
    try:
        if (role is None or node.get_role_name() == role) and (
            name is None or node.get_name() == name
        ):
            return node
        for child in children(node):
            match = find(child, role=role, name=name)
            if match is not None:
                return match
    except Exception:
        return None
    return None


def portal_app():
    desktop = Atspi.get_desktop(0)
    return next(
        (
            app
            for app in children(desktop)
            if app.get_name() == "xdg-desktop-portal-gnome"
        ),
        None,
    )


def portal_frames(app):
    if app is None:
        return []
    return [
        frame
        for frame in children(app)
        if frame.get_role_name() == "frame" and frame.get_name() == "Compartilhar Tela"
    ]


def wait_for_portal(timeout: float):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app = portal_app()
        frames = portal_frames(app)
        if frames:
            active = next(
                (
                    frame
                    for frame in frames
                    if frame.get_state_set().contains(Atspi.StateType.ACTIVE)
                ),
                frames[-1],
            )
            return app, active
        time.sleep(0.1)
    raise TimeoutError("screen-share portal did not appear")


def invoke(node):
    action = node.get_action_iface()
    if action is None or action.get_n_actions() == 0 or not action.do_action(0):
        raise RuntimeError(
            f"could not activate {node.get_role_name()} {node.get_name()!r}"
        )


def share(monitor_prefix: str, timeout: float):
    app, frame = wait_for_portal(timeout)
    monitors = []

    def collect(node):
        try:
            if node.get_role_name() == "toggle button":
                monitors.append(node)
            for child in children(node):
                collect(child)
        except Exception:
            return

    collect(frame)
    if not monitors:
        raise RuntimeError("portal exposed no monitor choices")

    wanted = monitor_prefix.casefold()
    monitor = next(
        (item for item in monitors if item.get_name().casefold().startswith(wanted)),
        monitors[0],
    )
    invoke(monitor)

    button = find(frame, role="button", name="Compartilhar")
    if button is None:
        raise RuntimeError("portal share button not found")

    deadline = time.monotonic() + timeout
    while not button.get_state_set().contains(Atspi.StateType.SENSITIVE):
        if time.monotonic() >= deadline:
            raise TimeoutError("portal share button did not become enabled")
        time.sleep(0.05)
    invoke(button)

    print(
        json.dumps(
            {"action": "share", "monitor": monitor.get_name()},
            ensure_ascii=False,
        )
    )


def cancel_all():
    app = portal_app()
    cancelled = 0
    for frame in portal_frames(app):
        button = find(frame, role="button", name="Cancelar")
        if button is not None:
            invoke(button)
            cancelled += 1
            time.sleep(0.05)
    print(json.dumps({"action": "cancel", "count": cancelled}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("share", "cancel-all"))
    parser.add_argument("--monitor", default="PNP(JRY)")
    parser.add_argument("--timeout", type=float, default=12.0)
    args = parser.parse_args()

    Atspi.init()
    if args.action == "share":
        share(args.monitor, args.timeout)
    else:
        cancel_all()


if __name__ == "__main__":
    main()
