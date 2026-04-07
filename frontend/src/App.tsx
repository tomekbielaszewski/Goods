import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ListsScreen from './pages/ListsScreen'
import ListScreen from './pages/ListScreen'
import RepositoryScreen from './pages/RepositoryScreen'
import ItemDetailScreen from './pages/ItemDetailScreen'
import SettingsScreen from './pages/SettingsScreen'
import ConflictsScreen from './pages/ConflictsScreen'
import { scheduleSync } from './sync/syncClient'

function App() {
  useEffect(() => {
    const cleanup = scheduleSync()
    return cleanup
  }, [])

  return (
    <Routes>
      <Route element={<Layout><ListsScreen /></Layout>}       path="/" />
      <Route element={<Layout><ListScreen /></Layout>}        path="/list/:id" />
      <Route element={<Layout><RepositoryScreen /></Layout>}  path="/repository" />
      <Route element={<Layout><ItemDetailScreen /></Layout>}  path="/item/:id" />
      <Route element={<Layout><SettingsScreen /></Layout>}    path="/settings" />
      <Route element={<Layout><ConflictsScreen /></Layout>}   path="/conflicts" />
    </Routes>
  )
}

export default App
