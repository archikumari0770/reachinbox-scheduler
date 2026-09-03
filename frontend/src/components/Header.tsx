import { useState } from "react";
import { User } from "@/types";
import Button from "./Button";
import { slackConnectUrl, disconnectSlack, logout } from "@/lib/api";

interface HeaderProps {
  user: User;
  slackConnected: boolean;
  slackTeamName?: string | null;
  onSlackChange: () => void;
}

export default function Header({ user, slackConnected, slackTeamName, onSlackChange }: HeaderProps) {
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleSlackDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectSlack();
      onSlackChange();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/";
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          RI
        </div>
        <span className="text-lg font-semibold text-slate-900">ReachInbox Mini</span>
      </div>

      <div className="flex items-center gap-4">
        {slackConnected ? (
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <span>🔔 Slack connected{slackTeamName ? ` · ${slackTeamName}` : ""}</span>
            <button
              onClick={handleSlackDisconnect}
              disabled={disconnecting}
              className="text-emerald-500 underline hover:text-emerald-700"
            >
              disconnect
            </button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => (window.location.href = slackConnectUrl())}>
            Connect Slack
          </Button>
        )}

        <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt={user.name} className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight text-slate-900">{user.name}</p>
            <p className="text-xs leading-tight text-slate-400">{user.email}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
