import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { MainLayout } from './MainLayout'

vi.mock('../../app/providers', () => ({
  useNostr: () => ({ session: null, logout: vi.fn() }),
}))
vi.mock('../../pwa/usePWAInstall', () => ({
  usePWAInstall: () => ({ isInstallable: false, installApp: vi.fn() }),
}))
vi.mock('../../pwa/usePWAUpdate', () => ({
  usePWAUpdate: () => ({ needRefresh: false, update: vi.fn(), dismiss: vi.fn() }),
}))

describe('MainLayout immersive feed lifecycle', () => {
  it('renders one responsive feed tree rather than separate mobile and desktop copies', () => {
    const child = React.createElement('div', { 'data-testid': 'feed-instance' })
    const layout = React.createElement(MainLayout, { immersive: true, pathname: '/', children: child })
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, layout))

    expect(html.match(/data-testid="feed-instance"/g)).toHaveLength(1)
    expect(html).toContain('md:w-[720px]')
    expect(html).toContain('md:hidden')
  })
})
