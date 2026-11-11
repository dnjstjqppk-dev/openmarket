// P2-MOB-P6: customer support — FAQ (public) plus the buyer's own 1:1
// inquiries with answers, and a write form. Mirrors the web SupportView.
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'login_view.dart';

const supportCategories = ['주문/결제', '배송', '반품/환불', '상품', '기타'];

class SupportView extends StatefulWidget {
  const SupportView({super.key});

  @override
  State<SupportView> createState() => _SupportViewState();
}

class _SupportViewState extends State<SupportView>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  List<Map<String, dynamic>> _faq = [];
  String? _faqError;
  bool _faqLoading = true;
  List<Map<String, dynamic>> _mine = [];
  String? _myError;
  bool _myLoading = false;
  bool _authReady = false;
  String _category = supportCategories.first;
  final _subject = TextEditingController();
  final _message = TextEditingController();
  bool _sending = false;
  String? _sendError;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadFaq();
    _initAuth();
  }

  @override
  void dispose() {
    _tabs.dispose();
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _initAuth() async {
    await AuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (AuthSession.isAuthenticated) _loadMine();
  }

  Future<void> _loadFaq() async {
    setState(() {
      _faqLoading = true;
      _faqError = null;
    });
    try {
      final rows = await ApiService.getFaq();
      if (mounted) setState(() => _faq = rows);
    } on ApiException catch (e) {
      if (mounted) setState(() => _faqError = e.message);
    } finally {
      if (mounted) setState(() => _faqLoading = false);
    }
  }

  Future<void> _loadMine() async {
    setState(() {
      _myLoading = true;
      _myError = null;
    });
    try {
      final rows = await ApiService.getMyInquiries();
      if (mounted) setState(() => _mine = rows);
    } on AuthRequiredException {
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _myError = e.message);
    } finally {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _send() async {
    if (_subject.text.trim().isEmpty || _message.text.trim().isEmpty) {
      setState(() => _sendError = '제목과 내용을 입력해 주세요.');
      return;
    }
    setState(() {
      _sending = true;
      _sendError = null;
    });
    final r = await ApiService.submitInquiry(
      category: _category,
      subject: _subject.text.trim(),
      message: _message.text.trim(),
    );
    if (!mounted) return;
    setState(() => _sending = false);
    if (r['success'] == true) {
      _subject.clear();
      _message.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('문의가 등록되었습니다.')),
      );
      await _loadMine();
    } else {
      setState(() => _sendError =
          (r['error'] ?? '문의 등록에 실패했습니다.').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TabBar(controller: _tabs, tabs: const [
          Tab(text: '자주 묻는 질문'),
          Tab(text: '내 문의'),
        ]),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [_buildFaq(), _buildMine()],
          ),
        ),
      ],
    );
  }

  Widget _buildFaq() {
    if (_faqLoading) return const Center(child: CircularProgressIndicator());
    if (_faqError != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_faqError!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _loadFaq, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_faq.isEmpty) return const Center(child: Text('등록된 FAQ가 없습니다.'));
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _faq.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) => ExpansionTile(
        title: Text((_faq[i]['question'] ?? _faq[i]['title'] ?? '').toString(),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
                (_faq[i]['answer'] ?? _faq[i]['content'] ?? '').toString(),
                style: const TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Widget _buildMine() {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _initAuth, reason: '내 문의는 로그인이 필요합니다.');
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DropdownButtonFormField<String>(
          initialValue: _category,
          decoration: const InputDecoration(labelText: '문의 유형'),
          items: [
            for (final c in supportCategories)
              DropdownMenuItem(value: c, child: Text(c))
          ],
          onChanged: (v) => setState(() => _category = v ?? _category),
        ),
        const SizedBox(height: 8),
        TextField(
            controller: _subject,
            decoration: const InputDecoration(labelText: '제목')),
        const SizedBox(height: 8),
        TextField(
            controller: _message,
            decoration: const InputDecoration(labelText: '내용'),
            maxLines: 4),
        const SizedBox(height: 8),
        if (_sendError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_sendError!,
                style: const TextStyle(color: Colors.red, fontSize: 12)),
          ),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: ElevatedButton(
            onPressed: _sending ? null : _send,
            child: Text(_sending ? '등록 중...' : '문의 등록'),
          ),
        ),
        const SizedBox(height: 16),
        const Text('내 문의 내역',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        if (_myLoading)
          const Center(child: CircularProgressIndicator())
        else if (_myError != null)
          Center(
            child: Column(children: [
              Text(_myError!, style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _loadMine, child: const Text('다시 시도')),
            ]),
          )
        else if (_mine.isEmpty)
          const Card(
              child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('등록한 문의가 없습니다.'))))
        else
          for (final q in _mine)
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: Colors.grey.shade200),
              ),
              child: ExpansionTile(
                title: Text((q['subject'] ?? '').toString(),
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.bold)),
                subtitle: Text(
                    '${q['status'] ?? ''} · ${(q['category'] ?? '').toString()}',
                    style: const TextStyle(fontSize: 11)),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text((q['message'] ?? '').toString(),
                          style: const TextStyle(fontSize: 13)),
                    ),
                  ),
                  if ((q['admin_answer'] ?? '').toString().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text('답변: ${q['admin_answer']}',
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.bold)),
                      ),
                    ),
                ],
              ),
            ),
      ],
    );
  }
}
