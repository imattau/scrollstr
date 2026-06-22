import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { MainLayout } from '../components/layout/MainLayout'
import { VideoFeed } from '../features/feed/VideoFeed'
import { DiscoverPage } from '../features/discovery/DiscoverPage'
import { PostWizard } from '../features/post/PostWizard'
import { ActivityPage } from '../features/notifications/ActivityPage'
import { ProfilePage } from '../features/profile/ProfilePage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { DesktopCommentsPanel } from '../features/comments/DesktopCommentsPanel'

interface RouterProps {
  onActionTrigger: (actionType: string, videoId: string, creatorPubkey?: string) => void
  activeVideo: any
  onVideoChange: (video: any) => void
}

export const AppRouter: React.FC<RouterProps> = ({ onActionTrigger, activeVideo, onVideoChange }) => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <MainLayout immersive rightPanel={<DesktopCommentsPanel video={activeVideo} />}>
            <VideoFeed onActionTrigger={onActionTrigger} onVideoChange={onVideoChange} />
          </MainLayout>
        }
      />
      <Route
        path="/discover"
        element={
          <MainLayout>
            <DiscoverPage />
          </MainLayout>
        }
      />
      <Route
        path="/post"
        element={
          <MainLayout>
            <PostWizard />
          </MainLayout>
        }
      />
      <Route
        path="/activity"
        element={
          <MainLayout>
            <ActivityPage />
          </MainLayout>
        }
      />
      <Route
        path="/profile/:pubkey"
        element={
          <MainLayout>
            <ProfilePage />
          </MainLayout>
        }
      />
      <Route
        path="/profile/me"
        element={
          <MainLayout>
            <ProfilePage />
          </MainLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <MainLayout>
            <SettingsPage />
          </MainLayout>
        }
      />
    </Routes>
  )
}
