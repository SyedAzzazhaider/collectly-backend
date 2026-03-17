describe('Health Check', () => {
  it('should return ok from health endpoint', () => {
    cy.request('GET', '/health').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.status).to.eq('ok');
    });
  });
});