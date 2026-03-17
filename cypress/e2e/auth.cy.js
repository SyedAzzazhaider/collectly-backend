describe('Authentication Flow', () => {
  const uniqueEmail = `e2e_${Date.now()}@test.dev`;

  it('should sign up successfully', () => {
    cy.request('POST', '/api/v1/auth/signup', {
      name:            'E2E Test User',
      email:           uniqueEmail,
      password:        'SecurePass@123',
      confirmPassword: 'SecurePass@123',
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body.status).to.eq('success');
    });
  });

  it('should login successfully', () => {
    cy.request('POST', '/api/v1/auth/login', {
      email:    uniqueEmail,
      password: 'SecurePass@123',
    }).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body.data).to.have.property('accessToken');
    });
  });

  it('should return 401 for wrong credentials', () => {
    cy.request({
      method:           'POST',
      url:              '/api/v1/auth/login',
      body:             { email: 'wrong@test.dev', password: 'wrongpass' },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(401);
    });
  });
});