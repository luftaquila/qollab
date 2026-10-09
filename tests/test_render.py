"""Settings of the Pandoc and Typst renderer (containers/render.py)."""
import datetime
import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'render', pathlib.Path(__file__).resolve().parent.parent / 'containers' / 'render.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


class Migrate(unittest.TestCase):
    def setUp(self):
        render.warnings.clear()

    def test_geometry_becomes_margin(self):
        self.assertEqual(render.margin(['margin=25mm']), {'x': '25mm', 'y': '25mm'})
        self.assertEqual(render.margin(['top=20mm', 'left=1.5cm', 'bogus=3mm']), {'top': '20mm', 'left': '1.5cm'})
        self.assertEqual(render.migrate({'geometry': ['margin=15mm']})['margin'], {'x': '15mm', 'y': '15mm'})
        self.assertEqual(render.migrate({'margin-top': '2cm', 'margin-left': '1in'})['margin'], {'top': '2cm', 'left': '1in'})

    def test_latex_settings(self):
        out = render.migrate({
            'papersize': 'letter', 'colorlinks': False, 'pagestyle': 'empty', 'classoption': ['twocolumn'],
            'documentclass': 'report', 'pdf-engine': 'lualatex', 'fontsize': '12pt', 'mainfont': 'Pretendard',
        })
        self.assertEqual(out, {'papersize': 'us-letter', 'fontsize': '12pt', 'mainfont': 'Pretendard',
                               'linkcolor': 'none', 'page-numbering': False, 'columns': 2})
        self.assertIn('LaTeX setting documentclass is not used by Typst', render.warnings)
        self.assertIn('LaTeX setting pdf-engine is not used by Typst', render.warnings)

    def test_preamble(self):
        latex = render.migrate({'header-includes': '\\usepackage{titlesec}'})
        self.assertNotIn('header-includes', latex)
        self.assertTrue(any('preamble' in w for w in render.warnings))
        typst = render.migrate({'header-includes': '#set par(first-line-indent: 1em)'})
        self.assertEqual(typst['header-includes'], '#set par(first-line-indent: 1em)')

    def test_typst_settings_pass_through(self):
        options = {'papersize': 'a4', 'margin': {'x': '2cm'}, 'columns': 2, 'page-numbering': False}
        self.assertEqual(render.migrate(options), options)


class Settings(unittest.TestCase):
    def setUp(self):
        render.warnings.clear()
        self.dir = tempfile.TemporaryDirectory()
        self.root, render.ROOT = render.ROOT, pathlib.Path(self.dir.name)

    def tearDown(self):
        render.ROOT = self.root
        self.dir.cleanup()

    def write(self, name, text):
        path = render.ROOT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_document_overrides_project_and_format_options(self):
        self.write('_quarto.yml', 'papersize: a4\nlang: ko\ncrossref:\n  fig-title: 도\nformat:\n  typst:\n'
                   '    template-partials: [template/typst-show.typ]\n')
        self.write('docs/report.qmd', '---\ntitle: 보고서\npapersize: a5\ncrossref:\n  sec-prefix: 절\n'
                   'format:\n  pdf:\n    geometry: [margin=1cm]\n---\n\n본문\n')
        options, body = render.settings(pathlib.PurePosixPath('docs/report.qmd'))
        self.assertEqual(body, '\n본문\n')
        self.assertEqual(options['papersize'], 'a5')
        self.assertEqual(options['margin'], {'x': '1cm', 'y': '1cm'})
        self.assertEqual(options['crossref'], {'fig-title': '도', 'sec-prefix': '절'})
        self.assertEqual(options['template-partials'], [render.ROOT / 'template/typst-show.typ'])

    def test_defaults_follow_the_language(self):
        ko = render.metadata({'lang': 'ko-KR', 'number-sections': True, 'crossref': {'fig-title': '도'}})
        self.assertEqual(ko['crossref'], {'fig-title': '도', 'tbl-title': '표', 'eq-prefix': '방정식', 'sec-prefix': '섹션',
                                          'fig-prefix': '도', 'tbl-prefix': '표'})
        self.assertEqual((ko['toc-title'], ko['abstract-title'], ko['section-numbering']), ('목차', '초록', '1.1.a'))
        self.assertEqual(ko['qollab-callout']['warning'], '경고')
        en = render.metadata({})
        self.assertEqual((en['papersize'], en['page-numbering'], en['columns'], en['toc-depth']), ('us-letter', '1', 1, 3))
        self.assertEqual((en['fig-cap-location'], en['tbl-cap-location'], en['toc-title']), ('bottom', 'top', 'Table of contents'))

    def test_values(self):
        data = render.metadata({'date': 'today', 'author': '홍길동', 'bibliography': 'refs.bib',
                                'page-numbering': False, 'fig-cap-location': 'margin', 'keywords': ['x']})
        self.assertEqual(data['date'], datetime.date.today().isoformat())
        self.assertEqual((data['author'], data['bibliography']), (['홍길동'], ['refs.bib']))
        self.assertNotIn('page-numbering', data)
        self.assertEqual(data['fig-cap-location'], 'bottom')
        self.assertNotIn('keywords', data)
        self.assertIn('Setting keywords is not used by the renderer', render.warnings)

    def test_date_formats(self):
        day = datetime.date(2026, 10, 9)
        self.assertEqual([render.format_date(day, s, True) for s in ('full', 'long', 'medium', 'short')],
                         ['2026년 10월 9일 금요일', '2026년 10월 9일', '2026. 10. 9.', '26. 10. 9.'])
        self.assertEqual([render.format_date(day, s, False) for s in ('full', 'long', 'medium', 'short')],
                         ['Friday, October 9, 2026', 'October 9, 2026', 'Oct 9, 2026', '10/9/26'])
        self.assertEqual(render.metadata({'date': datetime.date(2026, 1, 5), 'date-format': 'long', 'lang': 'ko'})['date'],
                         '2026년 1월 5일')
        self.assertEqual(render.metadata({'date': '2026-01-05', 'date-format': 'medium'})['date'], 'Jan 5, 2026')
        self.assertEqual(render.metadata({'date': '2026년 봄'})['date'], '2026년 봄')

    def test_code_cells_become_code(self):
        self.assertEqual(render.CELL.sub(r'\1{.\2 .cell-code}', '```{python}\nx\n```\n```{=typst}\n```'),
                         '```{.python .cell-code}\nx\n```\n```{=typst}\n```')


if __name__ == '__main__':
    unittest.main()
