import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ListsScreen from './pages/ListsScreen'
import ListScreen from './pages/ListScreen'
import RepositoryScreen from './pages/RepositoryScreen'
import ItemDetailScreen from './pages/ItemDetailScreen'
import SettingsScreen from './pages/SettingsScreen'
import ShopItemsScreen from './pages/ShopItemsScreen'
import BugReportsScreen from './pages/BugReportsScreen'

function App() {
  return (
    <Routes>
      <Route element={<Layout><ListsScreen /></Layout>}       path="/" />
      <Route element={<Layout><ListScreen /></Layout>}        path="/list/:id" />
      <Route element={<Layout><RepositoryScreen /></Layout>}  path="/repository" />
      <Route element={<Layout><ItemDetailScreen /></Layout>}  path="/item/:id" />
      <Route element={<Layout><SettingsScreen /></Layout>}    path="/settings" />
      <Route element={<Layout><ShopItemsScreen /></Layout>}  path="/shop/:id" />
      <Route element={<Layout><BugReportsScreen /></Layout>}  path="/bug-reports" />
    </Routes>
  )
}

export default App
