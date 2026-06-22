import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { MainLayout } from '../components/layout/MainLayout'
import { VideoFeed } from '../features/feed/VideoFeed'
import { DiscoverPage } from '../features/discovery/DiscoverPage'
import { PostWizard } from '../features/post/PostWizard'
import { ActivityPage } from '../features/notifications/ActivityPage'
import { ProfilePage } from '../features/profile/ProfilePage'
import { SettingsPage } from '../features/settings/SettingsPage'

interface RouterProps {
  onActionTrigger: (actionType: string) => void
}

export const AppRouter: React.FC<RouterProps> = ({ onActionTrigger }) => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <MainLayout>
            <VideoFeed onActionTrigger={onActionTrigger} />
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
