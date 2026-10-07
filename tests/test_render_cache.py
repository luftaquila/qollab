import base64
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'containers'))
from render_cache import capture, restore, validate, LIMIT


class CacheTest(unittest.TestCase):
    def test_scope_and_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'report.tex'
            p.write_text('preamble\n\\begin{document}\nbody')
            p.with_suffix('.aux').write_text('references')
            state=capture(p)
            p.with_suffix('.aux').unlink()
            self.assertTrue(restore(state,p))
            self.assertEqual(p.with_suffix('.aux').read_text(),'references')
            p.write_text('different class\n\\begin{document}\nbody')
            self.assertFalse(restore(state,p))

    def test_untrusted_cache_paths_and_limits(self):
        state={'version':1,'preamble':'a'*64,'files':{'../secret':'eA=='}}
        self.assertIsNone(validate(state))
        state['files']={'.aux':base64.b64encode(b'x'*(LIMIT+1)).decode()}
        self.assertIsNone(validate(state))
        state['files']={'.aux':'!bad-base64'}
        self.assertIsNone(validate(state))
        self.assertIsNone(validate({'version':1}))

    def test_no_symlink_capture(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'report.tex';p.write_text('preamble\n\\begin{document}\nbody')
            p.with_suffix('.aux').symlink_to(p)
            self.assertIsNone(capture(p))


if __name__=='__main__':unittest.main()
