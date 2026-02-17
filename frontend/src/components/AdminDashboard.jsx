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

const pipelineStatusLabels = {
  new: 'New',
  contacted: 'Contacted',
  tour_scheduled: 'Tour Scheduled',
  joined: 'Joined',
  passed: 'Passed'
};

const pipelineStatusColors = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  tour_scheduled: 'bg-purple-100 text-purple-700',
  joined: 'bg-green-100 text-green-700',
  passed: 'bg-gray-100 text-gray-500'
};

const revenueTypeLabels = {
  membership: 'Membership',
  green_fee: 'Green Fee',
  pro_shop: 'Pro Shop',
  food_bev: 'Food & Bev'
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

  // Email
  const [emailActivity, setEmailActivity] = useState([]);
  const [emailSummary, setEmailSummary] = useState({ pending: 0, sent: 0, failed: 0 });
  const [emailTemplates, setEmailTemplates] = useState([]);

  // Pipeline
  const [pipelineProspects, setPipelineProspects] = useState([]);
  const [pipelineSummary, setPipelineSummary] = useState({});
  const [pipelineFilter, setPipelineFilter] = useState('all');

  // A/B Tests
  const [abTests, setAbTests] = useState([]);
  const [showCreateAbTest, setShowCreateAbTest] = useState(null);
  const [abTestForm, setAbTestForm] = useState({
    name: '', variantARewardType: '', variantADescription: '', variantAEmoji: '',
    variantBRewardType: '', variantBDescription: '', variantBEmoji: ''
  });

  // Segments
  const [segments, setSegments] = useState([]);
  const [segmentFilters, setSegmentFilters] = useState({});
  const [segmentPreviewCount, setSegmentPreviewCount] = useState(null);
  const [segmentName, setSegmentName] = useState('');
  const [viewingSegmentId, setViewingSegmentId] = useState(null);
  const [segmentCustomers, setSegmentCustomers] = useState([]);

  // Revenue
  const [revenueEvents, setRevenueEvents] = useState([]);
  const [revenueSummary, setRevenueSummary] = useState(null);
  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [revenueForm, setRevenueForm] = useState({
    customerId: '', eventType: 'green_fee', amount: '', source: '', locationId: '', notes: '', eventDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'team' && user?.role === 'admin') fetchTeamUsers();
    if (activeTab === 'pipeline' && user?.role === 'admin') fetchPipelineData();
    if (activeTab === 'segments' && user?.role === 'admin') fetchSegments();
    if (activeTab === 'email' && user?.role === 'admin') fetchEmailData();
    if (activeTab === 'revenue' && user?.role === 'admin') fetchRevenueData();
    if (activeTab === 'locations' && user?.role === 'admin') fetchAbTests();
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

  // ---- Team ----
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

  // ---- Email ----
  const fetchEmailData = async () => {
    try {
      const [emailsRes, templatesRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/emails`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/admin/email-templates`, { headers: authHeaders() })
      ]);
      const emailsData = await emailsRes.json();
      const templatesData = await templatesRes.json();
      setEmailActivity(emailsData.emails || []);
      setEmailSummary(emailsData.summary || { pending: 0, sent: 0, failed: 0 });
      setEmailTemplates(templatesData.templates || []);
    } catch (err) {
      console.error('Failed to fetch email data:', err);
    }
  };

  const handleProcessEmails = async () => {
    try {
      await fetch(`${API_URL}/api/admin/process-emails`, { headers: authHeaders() });
      await fetchEmailData();
    } catch (err) {
      console.error('Process emails error:', err);
    }
  };

  const handleToggleTemplate = async (template) => {
    try {
      await fetch(`${API_URL}/api/admin/email-templates/${template.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ is_active: !template.is_active })
      });
      await fetchEmailData();
    } catch (err) {
      console.error('Toggle template error:', err);
    }
  };

  // ---- Pipeline ----
  const fetchPipelineData = async () => {
    try {
      const url = pipelineFilter === 'all'
        ? `${API_URL}/api/admin/pipeline`
        : `${API_URL}/api/admin/pipeline?status=${pipelineFilter}`;
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      setPipelineProspects(data.prospects || []);
      setPipelineSummary(data.summary || {});
    } catch (err) {
      console.error('Failed to fetch pipeline:', err);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'pipeline') fetchPipelineData(); }, [pipelineFilter]);

  const handleUpdatePipeline = async (customerId, updates) => {
    try {
      await fetch(`${API_URL}/api/admin/pipeline/${customerId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(updates)
      });
      await fetchPipelineData();
    } catch (err) {
      console.error('Pipeline update error:', err);
    }
  };

  // ---- A/B Tests ----
  const fetchAbTests = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/ab-tests`, { headers: authHeaders() });
      const data = await res.json();
      setAbTests(data.tests || []);
    } catch (err) {
      console.error('Failed to fetch AB tests:', err);
    }
  };

  const handleCreateAbTest = async (locationId) => {
    try {
      await fetch(`${API_URL}/api/admin/ab-tests`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ locationId, ...abTestForm })
      });
      setShowCreateAbTest(null);
      setAbTestForm({ name: '', variantARewardType: '', variantADescription: '', variantAEmoji: '', variantBRewardType: '', variantBDescription: '', variantBEmoji: '' });
      await fetchAbTests();
    } catch (err) {
      console.error('Create AB test error:', err);
    }
  };

  const handleToggleAbTest = async (testId, currentActive) => {
    try {
      await fetch(`${API_URL}/api/admin/ab-tests/${testId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ is_active: !currentActive })
      });
      await fetchAbTests();
    } catch (err) {
      console.error('Toggle AB test error:', err);
    }
  };

  // ---- Segments ----
  const fetchSegments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/segments`, { headers: authHeaders() });
      const data = await res.json();
      setSegments(data.segments || []);
    } catch (err) {
      console.error('Failed to fetch segments:', err);
    }
  };

  const handlePreviewSegmentCount = async (filters) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/segments/preview-count`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ filters })
      });
      const data = await res.json();
      setSegmentPreviewCount(data.count);
    } catch (err) {
      console.error('Preview count error:', err);
    }
  };

  const handleCreateSegment = async () => {
    if (!segmentName.trim()) return;
    try {
      await fetch(`${API_URL}/api/admin/segments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: segmentName, filters: segmentFilters })
      });
      setSegmentName('');
      setSegmentFilters({});
      setSegmentPreviewCount(null);
      await fetchSegments();
    } catch (err) {
      console.error('Create segment error:', err);
    }
  };

  const handleViewSegmentCustomers = async (segmentId) => {
    try {
      if (viewingSegmentId === segmentId) {
        setViewingSegmentId(null);
        setSegmentCustomers([]);
        return;
      }
      const res = await fetch(`${API_URL}/api/admin/segments/${segmentId}/customers`, { headers: authHeaders() });
      const data = await res.json();
      setSegmentCustomers(data.customers || []);
      setViewingSegmentId(segmentId);
    } catch (err) {
      console.error('View segment customers error:', err);
    }
  };

  const handleExportSegment = async (segmentId) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/segments/${segmentId}/export`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `segment-export-${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export segment error:', err);
    }
  };

  const handleDeleteSegment = async (segmentId) => {
    try {
      await fetch(`${API_URL}/api/admin/segments/${segmentId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await fetchSegments();
    } catch (err) {
      console.error('Delete segment error:', err);
    }
  };

  // ---- Revenue ----
  const fetchRevenueData = async () => {
    try {
      const [eventsRes, summaryRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/revenue`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/admin/revenue/summary`, { headers: authHeaders() })
      ]);
      const eventsData = await eventsRes.json();
      const summaryData = await summaryRes.json();
      setRevenueEvents(eventsData.events || []);
      setRevenueSummary(summaryData);
    } catch (err) {
      console.error('Failed to fetch revenue data:', err);
    }
  };

  const handleRecordRevenue = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API_URL}/api/admin/revenue`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(revenueForm)
      });
      setRevenueForm({ customerId: '', eventType: 'green_fee', amount: '', source: '', locationId: '', notes: '', eventDate: new Date().toISOString().split('T')[0] });
      setShowRevenueForm(false);
      await fetchRevenueData();
    } catch (err) {
      console.error('Record revenue error:', err);
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

    if (diff < 86400000) {
      return 'Today ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diff < 172800000) {
      return 'Yesterday';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
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

              {/* Reward Popularity */}
              {analytics.rewardChoices?.length > 0 && (
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-3">Reward Popularity</p>
                  <div className="space-y-2">
                    {analytics.rewardChoices.map((r) => {
                      const rewardLabels = {
                        free_beer: '🍺 Free Beer',
                        free_soft_drink: '🥤 Soft Drink',
                        pro_shop_5: '🏌️ Pro Shop $5',
                        food_bev_5: '🍔 Food & Bev $5'
                      };
                      const totalRewards = analytics.rewardChoices.reduce((sum, x) => sum + parseInt(x.count), 0);
                      const pct = totalRewards > 0 ? Math.round((parseInt(r.count) / totalRewards) * 100) : 0;
                      return (
                        <div key={r.reward_type}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600">{rewardLabels[r.reward_type] || r.reward_type}</span>
                            <span className="text-xs font-medium text-gray-900">{r.count} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
          {['customers', 'prospects', 'locations'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab === 'customers' ? 'All Customers' : tab === 'prospects' ? 'Membership Prospects' : 'QR Locations'}
            </button>
          ))}
          {user?.role === 'admin' && ['pipeline', 'segments', 'email', 'revenue'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
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

        {/* Locations Tab (with A/B Test UI) */}
        {activeTab === 'locations' && (
          <div className="space-y-6">
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
                  <div className="mt-4 space-y-2">
                    <a
                      href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(window.location.origin + '/capture?location=' + location.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg transition"
                    >
                      Download QR Code
                    </a>
                    {user?.role === 'admin' && (
                      <button
                        onClick={() => setShowCreateAbTest(showCreateAbTest === location.id ? null : location.id)}
                        className="block w-full text-center text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-2 rounded-lg transition"
                      >
                        A/B Test
                      </button>
                    )}
                  </div>

                  {/* A/B Test Create Form (inline) */}
                  {showCreateAbTest === location.id && (
                    <div className="mt-3 p-3 bg-purple-50 rounded-lg space-y-2">
                      <input
                        type="text" placeholder="Test name"
                        value={abTestForm.name}
                        onChange={(e) => setAbTestForm({ ...abTestForm, name: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <div className="text-xs font-medium text-purple-700">Variant A</div>
                      <input
                        type="text" placeholder="Reward type (e.g. free_beer)"
                        value={abTestForm.variantARewardType}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantARewardType: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text" placeholder="Description"
                        value={abTestForm.variantADescription}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantADescription: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text" placeholder="Emoji"
                        value={abTestForm.variantAEmoji}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantAEmoji: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <div className="text-xs font-medium text-purple-700">Variant B</div>
                      <input
                        type="text" placeholder="Reward type"
                        value={abTestForm.variantBRewardType}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantBRewardType: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text" placeholder="Description"
                        value={abTestForm.variantBDescription}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantBDescription: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text" placeholder="Emoji"
                        value={abTestForm.variantBEmoji}
                        onChange={(e) => setAbTestForm({ ...abTestForm, variantBEmoji: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <button
                        onClick={() => handleCreateAbTest(location.id)}
                        className="w-full text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg"
                      >
                        Start Test
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Active A/B Test Results */}
            {abTests.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">A/B Test Results</h3>
                <div className="space-y-4">
                  {abTests.map(test => {
                    const aRate = test.variants.A.total > 0 ? Math.round((test.variants.A.redeemed / test.variants.A.total) * 100) : 0;
                    const bRate = test.variants.B.total > 0 ? Math.round((test.variants.B.redeemed / test.variants.B.total) * 100) : 0;
                    const winner = test.variants.A.total + test.variants.B.total >= 10 ? (aRate > bRate ? 'A' : bRate > aRate ? 'B' : 'Tie') : 'Collecting data...';
                    return (
                      <div key={test.id} className="border border-gray-100 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{test.name}</p>
                            <p className="text-xs text-gray-500">{test.location_name}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded-full ${test.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {test.is_active ? 'Active' : 'Ended'}
                            </span>
                            <button
                              onClick={() => handleToggleAbTest(test.id, test.is_active)}
                              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
                            >
                              {test.is_active ? 'End' : 'Restart'}
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="text-xs text-blue-600 mb-1">Variant A: {test.variant_a_description}</p>
                            <p className="text-lg font-bold text-blue-700">{test.variants.A.total}</p>
                            <p className="text-xs text-blue-500">{aRate}% redeemed</p>
                          </div>
                          <div className="bg-orange-50 rounded-lg p-3">
                            <p className="text-xs text-orange-600 mb-1">Variant B: {test.variant_b_description}</p>
                            <p className="text-lg font-bold text-orange-700">{test.variants.B.total}</p>
                            <p className="text-xs text-orange-500">{bRate}% redeemed</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3 flex flex-col items-center justify-center">
                            <p className="text-xs text-gray-500 mb-1">Winner</p>
                            <p className={`text-lg font-bold ${winner === 'A' ? 'text-blue-700' : winner === 'B' ? 'text-orange-700' : 'text-gray-500'}`}>
                              {winner}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pipeline Tab */}
        {activeTab === 'pipeline' && user?.role === 'admin' && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-5 gap-3">
              {[
                { key: 'new_count', label: 'New', color: 'blue' },
                { key: 'contacted_count', label: 'Contacted', color: 'yellow' },
                { key: 'tour_count', label: 'Tour Scheduled', color: 'purple' },
                { key: 'joined_count', label: 'Joined', color: 'green' },
                { key: 'passed_count', label: 'Passed', color: 'gray' }
              ].map(s => (
                <div key={s.key} className={`bg-white rounded-lg p-3 border border-gray-200 text-center cursor-pointer hover:shadow-sm transition ${pipelineFilter === s.label.toLowerCase().replace(' ', '_') ? 'ring-2 ring-green-500' : ''}`}
                  onClick={() => setPipelineFilter(pipelineFilter === s.key.replace('_count', '') ? 'all' : s.key.replace('_count', ''))}
                >
                  <p className="text-2xl font-bold text-gray-900">{pipelineSummary[s.key] || 0}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Pipeline Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Score</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Assigned To</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pipelineProspects.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                              <span className="text-green-700 text-sm font-medium">
                                {p.first_name?.[0]}{p.last_name?.[0]}
                              </span>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{p.first_name} {p.last_name}</p>
                              <p className="text-xs text-gray-500">{p.visit_count || 1}x visits</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-900">{p.email}</p>
                          <p className="text-xs text-gray-500">{p.phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block text-sm font-bold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                            {p.membership_score}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={p.status}
                            onChange={(e) => handleUpdatePipeline(p.customer_id, { status: e.target.value })}
                            className={`text-xs px-2 py-1 rounded-lg border-0 font-medium ${pipelineStatusColors[p.status] || 'bg-gray-100'}`}
                          >
                            {Object.entries(pipelineStatusLabels).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            defaultValue={p.notes || ''}
                            onBlur={(e) => { if (e.target.value !== (p.notes || '')) handleUpdatePipeline(p.customer_id, { notes: e.target.value }); }}
                            placeholder="Add notes..."
                            className="text-xs px-2 py-1 border border-gray-200 rounded w-full max-w-[200px]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={p.assigned_to || ''}
                            onChange={(e) => handleUpdatePipeline(p.customer_id, { assigned_to: e.target.value })}
                            className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
                          >
                            <option value="">Unassigned</option>
                            {teamUsers.map(u => (
                              <option key={u.id} value={u.name}>{u.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pipelineProspects.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-500">
                  No prospects in pipeline. They will appear automatically when high-scoring local customers are captured.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Segments Tab */}
        {activeTab === 'segments' && user?.role === 'admin' && (
          <div className="space-y-4">
            {/* Segment Builder */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">New Segment</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Booking Source</label>
                  <select
                    value={segmentFilters.booking_source?.[0] || ''}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value) f.booking_source = [e.target.value]; else delete f.booking_source;
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Any</option>
                    <option value="golfnow">GolfNow</option>
                    <option value="website">Website</option>
                    <option value="phone">Phone</option>
                    <option value="walkin">Walk-in</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Local / Visitor</label>
                  <select
                    value={segmentFilters.is_local === undefined ? '' : String(segmentFilters.is_local)}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value === '') delete f.is_local; else f.is_local = e.target.value === 'true';
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Any</option>
                    <option value="true">Local</option>
                    <option value="false">Visitor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Play Frequency</label>
                  <select
                    value={segmentFilters.play_frequency?.[0] || ''}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value) f.play_frequency = [e.target.value]; else delete f.play_frequency;
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Any</option>
                    <option value="weekly">Weekly+</option>
                    <option value="monthly">Monthly</option>
                    <option value="rarely">Rarely</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Score</label>
                  <input
                    type="number"
                    value={segmentFilters.min_score || ''}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value) f.min_score = parseInt(e.target.value); else delete f.min_score;
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Visits</label>
                  <input
                    type="number"
                    value={segmentFilters.min_visits || ''}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value) f.min_visits = parseInt(e.target.value); else delete f.min_visits;
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    placeholder="1"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Days Since Visit</label>
                  <input
                    type="number"
                    value={segmentFilters.max_days_since_visit || ''}
                    onChange={(e) => {
                      const f = { ...segmentFilters };
                      if (e.target.value) f.max_days_since_visit = parseInt(e.target.value); else delete f.max_days_since_visit;
                      setSegmentFilters(f);
                      handlePreviewSegmentCount(f);
                    }}
                    placeholder="Max days"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div className="col-span-2 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Segment Name</label>
                    <input
                      type="text"
                      value={segmentName}
                      onChange={(e) => setSegmentName(e.target.value)}
                      placeholder="e.g. Local Weekly Golfers"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <button
                    onClick={handleCreateSegment}
                    disabled={!segmentName.trim()}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    Save Segment
                  </button>
                </div>
              </div>
              {segmentPreviewCount !== null && (
                <div className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">
                  Preview: <strong>{segmentPreviewCount}</strong> customers match these filters
                </div>
              )}
            </div>

            {/* Saved Segments */}
            <div className="space-y-3">
              {segments.map(seg => (
                <div key={seg.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h4 className="text-sm font-semibold text-gray-900">{seg.name}</h4>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{seg.customer_count} customers</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleViewSegmentCustomers(seg.id)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-lg">
                        {viewingSegmentId === seg.id ? 'Hide' : 'View'}
                      </button>
                      <button onClick={() => handleExportSegment(seg.id)} className="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1 rounded-lg">
                        Export CSV
                      </button>
                      <button onClick={() => handleDeleteSegment(seg.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1 rounded-lg">
                        Delete
                      </button>
                    </div>
                  </div>
                  {seg.description && <p className="text-xs text-gray-500 mt-1">{seg.description}</p>}

                  {/* Segment Customers */}
                  {viewingSegmentId === seg.id && segmentCustomers.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Name</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Email</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Score</th>
                            <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Visits</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {segmentCustomers.slice(0, 20).map(c => (
                            <tr key={c.id}>
                              <td className="px-3 py-2 text-xs text-gray-900">{c.first_name} {c.last_name}</td>
                              <td className="px-3 py-2 text-xs text-gray-600">{c.email}</td>
                              <td className="px-3 py-2 text-xs text-gray-600">{c.membership_score}</td>
                              <td className="px-3 py-2 text-xs text-gray-600">{c.visit_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {segmentCustomers.length > 20 && (
                        <p className="text-xs text-gray-400 mt-2 px-3">Showing 20 of {segmentCustomers.length}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {segments.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
                  No segments created yet. Use the builder above to create your first segment.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && user?.role === 'admin' && (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
                <p className="text-2xl font-bold text-yellow-600">{emailSummary.pending || 0}</p>
                <p className="text-xs text-gray-500">Pending</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
                <p className="text-2xl font-bold text-green-600">{emailSummary.sent || 0}</p>
                <p className="text-xs text-gray-500">Sent</p>
              </div>
              <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
                <p className="text-2xl font-bold text-red-600">{emailSummary.failed || 0}</p>
                <p className="text-xs text-gray-500">Failed</p>
              </div>
            </div>

            <button
              onClick={handleProcessEmails}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Process Now
            </button>

            {/* Templates */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Email Templates</h3>
              <div className="space-y-2">
                {emailTemplates.map(tmpl => (
                  <div key={tmpl.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm text-gray-900">{tmpl.name}</p>
                      <p className="text-xs text-gray-500">{tmpl.subject} - Delay: {tmpl.delay_hours}h</p>
                    </div>
                    <button
                      onClick={() => handleToggleTemplate(tmpl)}
                      className={`text-xs px-3 py-1 rounded-lg font-medium ${
                        tmpl.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {tmpl.is_active ? 'Active' : 'Paused'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Email Activity Log */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Recipient</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Template</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Status</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {emailActivity.slice(0, 50).map(email => (
                      <tr key={email.id}>
                        <td className="px-4 py-2 text-xs text-gray-900">{email.first_name} {email.last_name} ({email.to_email})</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{email.template_name || 'Custom'}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            email.status === 'sent' ? 'bg-green-100 text-green-700' :
                            email.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            email.status === 'failed' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {email.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{formatDate(email.sent_at || email.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {emailActivity.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-500">
                  No email activity yet. Emails will appear here after captures trigger automated follow-ups.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Revenue Tab */}
        {activeTab === 'revenue' && user?.role === 'admin' && (
          <div className="space-y-4">
            {/* Summary Cards */}
            {revenueSummary && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl p-4 border border-gray-200 bg-gradient-to-br from-green-50 to-white">
                    <p className="text-sm text-green-700">Total Revenue</p>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(revenueSummary.total)}</p>
                  </div>
                  {revenueSummary.byType?.map(t => (
                    <div key={t.event_type} className="bg-white rounded-xl p-4 border border-gray-200">
                      <p className="text-sm text-gray-500">{revenueTypeLabels[t.event_type] || t.event_type}</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCurrency(t.total)}</p>
                      <p className="text-xs text-gray-400">{t.count} transactions</p>
                    </div>
                  ))}
                </div>

                {/* Funnel */}
                {revenueSummary.funnel && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Conversion Funnel</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Captures', value: revenueSummary.funnel.captures, color: 'bg-blue-500' },
                        { label: 'Redeemed', value: revenueSummary.funnel.redeemed, color: 'bg-green-500' },
                        { label: 'Repeat Visitors', value: revenueSummary.funnel.repeat, color: 'bg-purple-500' },
                        { label: 'Revenue Customers', value: revenueSummary.funnel.revenue, color: 'bg-amber-500' }
                      ].map((step, i) => {
                        const maxVal = revenueSummary.funnel.captures || 1;
                        const pct = Math.round((step.value / maxVal) * 100);
                        return (
                          <div key={step.label} className="text-center">
                            <div className="h-24 flex items-end justify-center mb-2">
                              <div className={`${step.color} rounded-t-lg w-12`} style={{ height: `${Math.max(pct, 5)}%` }} />
                            </div>
                            <p className="text-lg font-bold text-gray-900">{step.value}</p>
                            <p className="text-xs text-gray-500">{step.label}</p>
                            {i > 0 && <p className="text-xs text-gray-400">{pct}%</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top Customers */}
                {revenueSummary.topCustomers?.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Customers by LTV</h3>
                    <div className="space-y-2">
                      {revenueSummary.topCustomers.map((c, i) => (
                        <div key={i} className="flex items-center justify-between py-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                            <span className="text-sm text-gray-900">{c.first_name} {c.last_name}</span>
                            <span className="text-xs text-gray-400">{c.transactions} txns</span>
                          </div>
                          <span className="text-sm font-bold text-green-700">{formatCurrency(c.ltv)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Record Revenue Form */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Revenue Events</h3>
              <button
                onClick={() => setShowRevenueForm(!showRevenueForm)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Record Revenue
              </button>
            </div>

            {showRevenueForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <form onSubmit={handleRecordRevenue} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Customer (search)</label>
                    <select
                      value={revenueForm.customerId}
                      onChange={(e) => setRevenueForm({ ...revenueForm, customerId: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">No customer</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.first_name} {c.last_name} - {c.email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                    <select
                      value={revenueForm.eventType}
                      onChange={(e) => setRevenueForm({ ...revenueForm, eventType: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                      required
                    >
                      {Object.entries(revenueTypeLabels).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={revenueForm.amount}
                      onChange={(e) => setRevenueForm({ ...revenueForm, amount: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
                    <input
                      type="text"
                      value={revenueForm.source}
                      onChange={(e) => setRevenueForm({ ...revenueForm, source: e.target.value })}
                      placeholder="e.g. walk-in, online"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                    <select
                      value={revenueForm.locationId}
                      onChange={(e) => setRevenueForm({ ...revenueForm, locationId: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">None</option>
                      {locations.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                    <input
                      type="date"
                      value={revenueForm.eventDate}
                      onChange={(e) => setRevenueForm({ ...revenueForm, eventDate: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                    <input
                      type="text"
                      value={revenueForm.notes}
                      onChange={(e) => setRevenueForm({ ...revenueForm, notes: e.target.value })}
                      placeholder="Optional notes"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-3 flex gap-3">
                    <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium">
                      Record
                    </button>
                    <button type="button" onClick={() => setShowRevenueForm(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-2 rounded-lg text-sm font-medium">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Events Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Date</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Customer</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Type</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Amount</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Source</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {revenueEvents.map(ev => (
                      <tr key={ev.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-gray-600">{ev.event_date?.split('T')[0]}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{ev.first_name ? `${ev.first_name} ${ev.last_name}` : '-'}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{revenueTypeLabels[ev.event_type] || ev.event_type}</span>
                        </td>
                        <td className="px-4 py-2 text-xs font-medium text-green-700">{formatCurrency(ev.amount)}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{ev.source || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{ev.location_name || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {revenueEvents.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-500">
                  No revenue events recorded yet. Click "Record Revenue" to add your first entry.
                </div>
              )}
            </div>
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
