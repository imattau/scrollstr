import React, { Suspense } from 'react'
import { Routes, Route, useLocation, useSearchParams } from 'react-router-dom'
import { MainLayout } from '../components/layout/MainLayout'
import { DesktopCommentsPanel } from '../features/comments/DesktopCommentsPanel'

const VideoFeed = React.lazy(() => import('../features/feed/VideoFeed').then(m => ({ default: m.VideoFeed })))
const DiscoverPage = React.lazy(() => import('../features/discovery/DiscoverPage').then(m => ({ default: m.DiscoverPage })))
const PostWizard = React.lazy(() => import('../features/post/PostWizard').then(m => ({ default: m.PostWizard })))
const ActivityPage = React.lazy(() => import('../features/notifications/ActivityPage').then(m => ({ default: m.ActivityPage })))
const ProfilePage = React.lazy(() => import('../features/profile/ProfilePage').then(m => ({ default: m.ProfilePage })))
const SettingsPage = React.lazy(() => import('../features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))

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
