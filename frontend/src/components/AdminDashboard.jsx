import { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const bookingSourceLabels = {
  golfnow: 'GolfNow',
  website: 'Website',
  phone: 'Phone',
  walkin: 'Walk-in'
};

const playFrequencyLabels = {
  rarely: 'Few times/year',
  monthly: 'Monthly',
  weekly: 'Weekly+'
};

export default function AdminDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('customers');
  const [customers, setCustomers] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [locations, setLocations] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBookingSource, setFilterBookingSource] = useState('all');
  const [filterType, setFilterType] = useState('all');
  
  // Redemption
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemResult, setRedeemResult] = useState(null);

  // Team management
  const [teamUsers, setTeamUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [teamError, setTeamError] = useState('');
  const [teamLoading, setTeamLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'team' && user?.role === 'admin') {
      fetchTeamUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user?.role]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [customersRes, prospectsRes, locationsRes, analyticsRes] = await Promise.all([
        fetch(`${API_URL}/api/customers?limit=100`),
        fetch(`${API_URL}/api/prospects`),
        fetch(`${API_URL}/api/locations`),
        fetch(`${API_URL}/api/analytics`)
      ]);
      
      const [customersData, prospectsData, locationsData, analyticsData] = await Promise.all([
        customersRes.json(),
        prospectsRes.json(),
        locationsRes.json(),
        analyticsRes.json()
      ]);
      
      setCustomers(customersData.customers || []);
      setProspects(prospectsData.prospects || []);
      setLocations(locationsData.locations || []);
      setAnalytics(analyticsData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
    setLoading(false);
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return;
    
    try {
      const response = await fetch(`${API_URL}/api/rewards/${redeemCode}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redeemedBy: 'Staff' })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setRedeemResult({ success: true, message: 'Code redeemed successfully!' });
        setRedeemCode('');
      } else {
        setRedeemResult({ success: false, message: data.error || 'Code not found or already used' });
      }
    } catch (error) {
      setRedeemResult({ success: false, message: 'Failed to redeem code' });
    }
    
    setTimeout(() => setRedeemResult(null), 3000);
  };

  const handleExport = async () => {
    window.open(`${API_URL}/api/export/customers`, '_blank');
  };

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
  });

  const fetchTeamUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setTeamUsers(data.users || []);
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setTeamError('');
    setTeamLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(newUser)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setNewUser({ name: '', email: '', password: '', role: 'staff' });
      setShowAddUser(false);
      await fetchTeamUsers();
    } catch (err) {
      setTeamError(err.message);
    } finally {
      setTeamLoading(false);
    }
  };

  const handleToggleActive = async (targetUser) => {
    if (String(targetUser.id) === String(user.id)) return;
    try {
      await fetch(`${API_URL}/api/admin/users/${targetUser.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ is_active: !targetUser.is_active })
      });
      await fetchTeamUsers();
    } catch (err) {
      console.error('Toggle active error:', err);
    }
  };

  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = 
      !searchTerm ||
      customer.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBookingSource = filterBookingSource === 'all' || customer.booking_source === filterBookingSource;
    const matchesType = filterType === 'all' || 
      (filterType === 'local' && customer.is_local) ||
      (filterType === 'visitor' && !customer.is_local) ||
      (filterType === 'prospect' && customer.is_membership_prospect);
    return matchesSearch && matchesBookingSource && matchesType;
  });

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000) { // Less than 24 hours
      return 'Today ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diff < 172800000) { // Less than 48 hours
      return 'Yesterday';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 mx-auto text-green-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Crescent Pointe</h1>
              <p className="text-sm text-gray-500">Customer Capture Dashboard</p>
            </div>
          </div>
          
          {/* Redeem Code Input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              placeholder="Enter code"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-32 font-mono"
            />
            <button 
              onClick={handleRedeem}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Redeem
            </button>
            <button 
              onClick={handleExport}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
            <div className="border-l border-gray-300 h-8 mx-2"></div>
            <div className="flex items-center gap-3">
              {user && (
                <span className="text-sm text-gray-600">
                  {user.name}
                </span>
              )}
              <button
                onClick={onLogout}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
        
        {/* Redeem Result Toast */}
        {redeemResult && (
          <div className={`px-4 py-2 text-center text-sm ${redeemResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {redeemResult.message}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        {analytics && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm text-gray-500">Today</p>
                <p className="text-2xl font-bold text-gray-900">{analytics.capturesToday}</p>
                <p className="text-xs text-green-600 mt-1">captures</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm text-gray-500">This Week</p>
                <p className="text-2xl font-bold text-gray-900">{analytics.capturesThisWeek}</p>
                <p className="text-xs text-gray-400 mt-1">captures</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm text-gray-500">Total Customers</p>
                <p className="text-2xl font-bold text-gray-900">{analytics.totalCustomers}</p>
                <p className="text-xs text-gray-400 mt-1">in database</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm text-gray-500">Redemption</p>
                <p className="text-2xl font-bold text-gray-900">{analytics.redemptionRate}%</p>
                <p className="text-xs text-gray-400 mt-1">codes used</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200 bg-gradient-to-br from-green-50 to-white">
                <p className="text-sm text-green-700">Prospects</p>
                <p className="text-2xl font-bold text-green-700">{analytics.prospectsCount}</p>
                <p className="text-xs text-green-600 mt-1">membership candidates</p>
              </div>
            </div>

            {/* Insights Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              {/* Booking Source */}
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-3">How They Booked</p>
                <div className="space-y-2">
                  {analytics.bookingSources?.map((source) => {
                    const percent = analytics.totalCustomers > 0 
                      ? Math.round((source.count / analytics.totalCustomers) * 100) 
                      : 0;
                    return (
                      <div key={source.booking_source} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-16">{bookingSourceLabels[source.booking_source] || source.booking_source}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${
                              source.booking_source === 'golfnow' ? 'bg-blue-500' : 
                              source.booking_source === 'website' ? 'bg-green-500' : 
                              source.booking_source === 'phone' ? 'bg-yellow-500' : 'bg-purple-500'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-900 w-12 text-right">{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Local vs Visitor */}
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-3">Local vs. Visitor</p>
                {analytics.localVsVisitor && (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Local</span>
                        <span className="text-xs font-medium text-gray-900">{analytics.localVsVisitor.local_count || 0}</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 rounded-full" 
                          style={{ width: `${analytics.totalCustomers > 0 ? (analytics.localVsVisitor.local_count / analytics.totalCustomers) * 100 : 0}%` }} 
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Visiting</span>
                        <span className="text-xs font-medium text-gray-900">{analytics.localVsVisitor.visitor_count || 0}</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-orange-500 rounded-full" 
                          style={{ width: `${analytics.totalCustomers > 0 ? (analytics.localVsVisitor.visitor_count / analytics.totalCustomers) * 100 : 0}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Captures by Location */}
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <p className="text-sm font-medium text-gray-700 mb-3">QR Performance (7 days)</p>
                <div className="space-y-2">
                  {analytics.capturesByLocation?.map((loc) => (
                    <div key={loc.name} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{loc.name}</span>
                      <span className="text-sm font-medium text-gray-900">{loc.count} captures</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === 'customers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All Customers
          </button>
          <button
            onClick={() => setActiveTab('prospects')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === 'prospects' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Membership Prospects
          </button>
          <button
            onClick={() => setActiveTab('locations')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === 'locations' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            QR Locations
          </button>
          {user?.role === 'admin' && (
            <button
              onClick={() => setActiveTab('team')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                activeTab === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Team
            </button>
          )}
        </div>

        {/* Customers Tab */}
        {activeTab === 'customers' && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  />
                </div>
                <select
                  value={filterBookingSource}
                  onChange={(e) => setFilterBookingSource(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                >
                  <option value="all">All Sources</option>
                  <option value="golfnow">GolfNow</option>
                  <option value="website">Website</option>
                  <option value="phone">Phone</option>
                  <option value="walkin">Walk-in</option>
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                >
                  <option value="all">All Types</option>
                  <option value="local">Locals Only</option>
                  <option value="visitor">Visitors Only</option>
                  <option value="prospect">Prospects Only</option>
                </select>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Profile</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Added</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${customer.is_membership_prospect ? 'bg-green-100' : 'bg-gray-100'}`}>
                              <span className={`text-sm font-medium ${customer.is_membership_prospect ? 'text-green-700' : 'text-gray-600'}`}>
                                {customer.first_name?.[0]}{customer.last_name?.[0]}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{customer.first_name} {customer.last_name}</p>
                              <p className="text-xs text-gray-500">{customer.zip}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-900">{customer.email || 'No email'}</p>
                          <p className="text-xs text-gray-500">{customer.phone || 'No phone'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs px-2 py-1 rounded-full ${
                            customer.booking_source === 'golfnow' ? 'bg-blue-100 text-blue-700' :
                            customer.booking_source === 'website' ? 'bg-green-100 text-green-700' :
                            customer.booking_source === 'phone' ? 'bg-yellow-100 text-yellow-700' :
                            customer.booking_source === 'walkin' ? 'bg-purple-100 text-purple-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {bookingSourceLabels[customer.booking_source] || customer.source || 'Unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {customer.is_local !== null && (
                              <span className={`inline-block text-xs px-2 py-0.5 rounded ${
                                customer.is_local ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                              }`}>
                                {customer.is_local ? 'Local' : 'Visitor'}
                              </span>
                            )}
                            {customer.play_frequency && (
                              <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                {playFrequencyLabels[customer.play_frequency]}
                              </span>
                            )}
                            {customer.visit_count > 1 && (
                              <span className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                {customer.visit_count}x
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  customer.membership_score >= 70 ? 'bg-green-500' :
                                  customer.membership_score >= 50 ? 'bg-yellow-500' : 'bg-gray-400'
                                }`}
                                style={{ width: `${customer.membership_score}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-600">{customer.membership_score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-500">{formatDate(customer.created_at)}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredCustomers.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-500">
                  No customers found.
                </div>
              )}
            </div>
          </>
        )}

        {/* Prospects Tab */}
        {activeTab === 'prospects' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 bg-green-50 border-b border-green-100">
              <p className="text-sm text-green-800">
                These customers are <strong>local</strong>, play <strong>frequently</strong>, and have visited <strong>multiple times</strong>. They're your best membership candidates.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Visits</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Plays</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Member Elsewhere</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prospects.map((prospect) => (
                    <tr key={prospect.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                            <span className="text-green-700 text-sm font-medium">
                              {prospect.first_name?.[0]}{prospect.last_name?.[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{prospect.first_name} {prospect.last_name}</p>
                            <p className="text-xs text-gray-500">{prospect.zip}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-900">{prospect.email}</p>
                        <p className="text-xs text-gray-500">{prospect.phone}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block text-sm font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded">
                          {prospect.visit_count || 1}x
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700">
                          {playFrequencyLabels[prospect.play_frequency] || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-sm ${prospect.member_elsewhere ? 'text-orange-600' : 'text-green-600'}`}>
                          {prospect.member_elsewhere ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block text-sm font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                          {prospect.membership_score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {prospects.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">
                No membership prospects yet. Keep capturing!
              </div>
            )}
          </div>
        )}

        {/* Locations Tab */}
        {activeTab === 'locations' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {locations.map((location) => (
              <div key={location.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    location.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {location.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900">{location.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{location.captures_this_week || 0} captures this week</p>
                <p className="text-xs text-gray-400">{location.capture_count || 0} total</p>
                <div className="mt-4">
                  <a
                    href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(window.location.origin + '/capture?location=' + location.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg transition"
                  >
                    Download QR Code
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Team Tab */}
        {activeTab === 'team' && user?.role === 'admin' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
              <button
                onClick={() => { setShowAddUser(!showAddUser); setTeamError(''); }}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add User
              </button>
            </div>

            {/* Add User Form */}
            {showAddUser && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">New Team Member</h3>
                {teamError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4">{teamError}</div>
                )}
                <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Temporary Password</label>
                    <input
                      type="text"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none"
                      minLength={6}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 outline-none bg-white"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 flex gap-3">
                    <button
                      type="submit"
                      disabled={teamLoading}
                      className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {teamLoading ? 'Creating...' : 'Create User'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddUser(false); setTeamError(''); }}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Team Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Login</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {teamUsers.map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                              <span className="text-green-700 text-sm font-medium">
                                {member.name?.[0]?.toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-gray-900">{member.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{member.email}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs px-2 py-1 rounded-full font-medium ${
                            member.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {member.role === 'admin' ? 'Admin' : 'Staff'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            member.is_active ? 'text-green-700' : 'text-gray-400'
                          }`}>
                            <span className={`w-2 h-2 rounded-full ${member.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                            {member.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-500">
                            {member.last_login ? formatDate(member.last_login) : 'Never'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {String(member.id) !== String(user.id) && (
                            <button
                              onClick={() => handleToggleActive(member)}
                              className={`text-xs px-3 py-1 rounded-lg font-medium ${
                                member.is_active
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'bg-green-50 text-green-600 hover:bg-green-100'
                              }`}
                            >
                              {member.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                          {String(member.id) === String(user.id) && (
                            <span className="text-xs text-gray-400">You</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {teamUsers.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-500">
                  No team members found.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
