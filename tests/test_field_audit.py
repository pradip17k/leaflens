import csv
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ml'))
from audit_field_photos import audit

class FieldAuditTests(unittest.TestCase):
    def check_rows(self,rows):
        scratch=Path(__file__).resolve().parents[1]/'ml/data'
        scratch.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as name:
            root=Path(name)
            Image.new('RGB',(128,128),'green').save(root/'a.png')
            Image.new('RGB',(128,128),'yellow').save(root/'b.png')
            path=root/'labels.csv'
            with path.open('w',newline='') as handle:
                writer=csv.DictWriter(handle,fieldnames=['path','label','leaf_group','site_group','split','expert_confirmed'])
                writer.writeheader();writer.writerows(rows)
            return audit(path)

    def row(self,**extra):
        return dict(dict(path='a.png',label='tomato_healthy',leaf_group='a',site_group='site-a',split='test',expert_confirmed='yes'),**extra)

    def test_cross_split_site_leakage_rejected(self):
        result=self.check_rows([self.row(),self.row(path='b.png',leaf_group='b',split='train')])
        self.assertFalse(result['valid']);self.assertTrue(any('site_group crosses' in e for e in result['errors']))

    def test_unconfirmed_labels_and_duplicate_images_rejected(self):
        result=self.check_rows([self.row(),self.row(leaf_group='b',expert_confirmed='no')])
        self.assertFalse(result['valid']);self.assertEqual(len(result['errors']),2)

    def test_valid_independent_rows_and_path_escape(self):
        self.assertTrue(self.check_rows([self.row(),self.row(path='b.png',leaf_group='b',site_group='site-b',split='train')])['valid'])
        self.assertFalse(self.check_rows([self.row(path='../outside.png')])['valid'])

if __name__=='__main__':unittest.main()
