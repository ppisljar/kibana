import {
  ToastNotifications,
} from './toast_notifications';

describe('ToastNotifications', () => {
  describe('interface', () => {
    let toastNotifications;

    beforeEach(() => {
      toastNotifications = new ToastNotifications();
    });

    describe('add method', () => {
      test('adds a toast', () => {
        toastNotifications.add({});
        expect(toastNotifications.list.length).toBe(1);
      });

      test('adds a toast with an ID property', () => {
        toastNotifications.add({});
        expect(toastNotifications.list[0].id).toBe(0);
      });

      test('increments the toast ID', () => {
        toastNotifications.add({});
        toastNotifications.add({});
        expect(toastNotifications.list[1].id).toBe(1);
      });

      test('accepts a string', () => {
        toastNotifications.add('New toast');
        expect(toastNotifications.list[0].title).toBe('New toast');
      });
    });

    describe('remove method', () => {
      test('removes a toast', () => {
        const toast = toastNotifications.add('Test');
        toastNotifications.remove(toast);
        expect(toastNotifications.list.length).toBe(0);
      });
    });

    describe('addSuccess method', () => {
      test('adds a success toast', () => {
        toastNotifications.addSuccess({});
        expect(toastNotifications.list[0].color).toBe('success');
      });
    });

    describe('addWarning method', () => {
      test('adds a warning toast', () => {
        toastNotifications.addWarning({});
        expect(toastNotifications.list[0].color).toBe('warning');
      });
    });

    describe('addDanger method', () => {
      test('adds a danger toast', () => {
        toastNotifications.addDanger({});
        expect(toastNotifications.list[0].color).toBe('danger');
      });
    });
  });
});
