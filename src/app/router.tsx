import React from 'react'
import { Routes, Route, useLocation, useSearchParams } from 'react-router-dom'
import { MainLayout } from '../components/layout/MainLayout'
import { VideoFeed } from '../features/feed/VideoFeed'
import { DiscoverPage } from '../features/discovery/DiscoverPage'
import { PostWizard } from '../features/post/PostWizard'
import { ActivityPage } from '../features/notifications/ActivityPage'
import { ProfilePage } from '../features/profile/ProfilePage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { DesktopCommentsPanel } from '../features/comments/DesktopCommentsPanel'

interface RouterProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string, videoKind?: number) => void
  activeVideo: any
  onVideoChange: (video: any) => void
  isMuted: boolean
}

export const AppRouter: React.FC<RouterProps> = ({ onActionTrigger, activeVideo, onVideoChange, isMuted }) => {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const feedType = searchParams.get('feed') || 'explore'

  return (
    <Routes>
      <Route
        path="/"
        element={
          <MainLayout
            immersive
            rightPanel={<DesktopCommentsPanel video={activeVideo} />}
            pathname={location.pathname}
            feedType={feedType}
          >
            <VideoFeed onActionTrigger={onActionTrigger} onVideoChange={onVideoChange} isMuted={isMuted} />
          </MainLayout>
        }
      />
      <Route
        path="/discover"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <DiscoverPage />
          </MainLayout>
        }
      />
      <Route
        path="/post"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <PostWizard />
          </MainLayout>
        }
      />
      <Route
        path="/activity"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <ActivityPage />
          </MainLayout>
        }
      />
      <Route
        path="/profile/:pubkey"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <ProfilePage />
          </MainLayout>
        }
      />
      <Route
        path="/profile/me"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <ProfilePage />
          </MainLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <MainLayout pathname={location.pathname} feedType={feedType}>
            <SettingsPage />
          </MainLayout>
        }
      />
    </Routes>
  )
}
