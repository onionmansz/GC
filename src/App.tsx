import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { useMyHousehold } from './api/queries'
import { Splash } from './components/ui'
import { Login } from './routes/Login'
import { AuthConfirm } from './routes/AuthConfirm'
import { Setup } from './routes/Setup'
import { Home } from './routes/Home'
import { MerchantPage } from './routes/MerchantPage'
import { CardDetail } from './routes/CardDetail'
import { TillMode } from './routes/TillMode'
import { EditCard, NewCard } from './routes/CardForm'
import { Archived } from './routes/Archived'
import { Settings } from './routes/Settings'
import { SetPassword } from './routes/SetPassword'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirm />} />
        <Route path="*" element={<Gate />} />
      </Routes>
    </BrowserRouter>
  )
}

function Gate() {
  const auth = useAuth()
  const household = useMyHousehold()

  if (auth.status === 'loading') return <Splash />
  if (auth.status === 'signedOut') return <Login />
  if (auth.needsPassword) return <SetPassword reason={auth.needsPassword} />
  if (household.isPending) return <Splash />
  if (household.isError && !household.data) {
    return <Splash text="Couldn't reach the server. Check your connection and reopen the app." />
  }
  if (!household.data) return <Setup />

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/m/:merchantId" element={<MerchantPage />} />
      <Route path="/c/:cardId" element={<CardDetail />} />
      <Route path="/c/:cardId/till" element={<TillMode />} />
      <Route path="/c/:cardId/edit" element={<EditCard />} />
      <Route path="/cards/new" element={<NewCard />} />
      <Route path="/archived" element={<Archived />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/set-password" element={<SetPassword reason="change" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
