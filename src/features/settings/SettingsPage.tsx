import React from 'react'

export const SettingsPage: React.FC = () => {
  const rows = [
    ['Identity and signer', 'NIP-46 remote signer'],
    ['Wallet', 'NWC connected'],
    ['Read relays', '5 relays'],
    ['Write relays', '3 relays'],
    ['Blossom servers', '2 media servers'],
    ['Autoplay and data', 'Wi‑Fi only'],
    ['Muted users and tags', '12 entries'],
    ['Content warnings', 'Blur sensitive media'],
    ['Cache and storage', '318 MB used'],
  ]

  return (
    <div className="flex min-h-full flex-col bg-[#09090b] px-4 pb-4 pt-4 text-[#f7f7f8]">
      <div className="flex h-[56px] items-center">
        <h2 className="text-[18px] font-bold">Settings</h2>
      </div>

      <div className="flex flex-1 flex-col">
        {rows.map(([title, subtitle]) => (
          <div key={title} className="flex items-start justify-between py-[18px]">
            <div>
              <p className="text-[14px] font-medium text-[#f7f7f8]">{title}</p>
              <p className="text-[11px] font-normal text-[#a1a1aa]">{subtitle}</p>
            </div>
            <span className="text-[22px] leading-none text-[#71717a]">›</span>
          </div>
        ))}
      </div>
    </div>
  )
}
